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
    const ownsGroup = process.env.KOVAR_PROCESS_GROUP !== "1";
    const child = spawn(command, args, {
      cwd,
      env: { ...env, KOVAR_PROCESS_GROUP: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32" && ownsGroup,
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
          process.kill(ownsGroup ? -child.pid : child.pid, signal);
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
      else onOutput(data);
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
      if (ownsGroup && process.platform !== "win32") kill();
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      if (failure || code !== 0)
        reject(failure ?? new Error(`${command} exited ${code}`));
      else resolve();
    });
  });
}
