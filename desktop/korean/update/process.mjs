import { spawn, spawnSync } from "node:child_process";

/** Run trusted build/test commands with a deadline, capped logs and process-tree cleanup. */
export function command(
  command,
  args,
  {
    cwd,
    env = process.env,
    timeout = 20 * 60_000,
    onOutput = (data) => process.stdout.write(data),
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let failure;
    let bytes = 0;
    let escalation;
    const kill = (signal = "SIGKILL") => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const result = spawnSync(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { timeout: 10_000, stdio: "ignore" },
        );
        if (result.error || result.status !== 0)
          failure = new Error("Process-tree cleanup failed");
      } else {
        try {
          // Nested supervisors may create their own process groups. Include all
          // descendants before signalling the root, so reparenting cannot hide them.
          const snapshot = spawnSync(
            "ps",
            ["-A", "-o", "pid=", "-o", "ppid="],
            { encoding: "utf8", timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
          );
          if (snapshot.error || snapshot.status !== 0)
            throw new Error("Cannot inspect descendant processes for cleanup");
          const pairs = snapshot.stdout
            .trim()
            .split("\n")
            .map((line) => line.trim().split(/\s+/).map(Number));
          const owned = new Set([child.pid]);
          for (let changed = true; changed; ) {
            changed = false;
            for (const [pid, parent] of pairs)
              if (owned.has(parent) && !owned.has(pid)) {
                owned.add(pid);
                changed = true;
              }
          }
          for (const pid of [...owned].reverse()) {
            try {
              process.kill(pid, signal);
            } catch (error) {
              if (error.code !== "ESRCH") throw error;
            }
          }
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== "ESRCH") failure = error;
        }
      }
    };
    const stop = (reason) => {
      if (failure) return;
      failure = new Error(reason);
      kill("SIGTERM");
      escalation = setTimeout(() => kill(), 10_000);
    };
    const interrupt = () => stop("Interrupted");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const timer = setTimeout(
      () => stop(`Deadline exceeded: ${command}`),
      timeout,
    );
    const receive = (data) => {
      bytes += data.length;
      if (bytes > 8 * 1024 * 1024) stop(`Output limit exceeded: ${command}`);
      else {
        try {
          onOutput(data);
        } catch (error) {
          stop(`Cannot write command output: ${error.message}`);
        }
      }
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      // The outer supervisor sweeps remaining descendants, including nested runners.
      if (process.platform !== "win32") kill();
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      if (failure || code !== 0)
        reject(failure ?? new Error(`${command} exited ${code}`));
      else resolve();
    });
  });
}
