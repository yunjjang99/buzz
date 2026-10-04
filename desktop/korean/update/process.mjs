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
    const kill = () => {
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
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") failure = error;
        }
      }
    };
    const stop = (reason) => {
      failure ??= new Error(reason);
      kill();
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
      else onOutput(data);
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      if (failure || code !== 0)
        reject(failure ?? new Error(`${command} exited ${code}`));
      else resolve();
    });
  });
}
