import { runTauriCommand } from "../scripts/tauri-command.mjs";

// Reuse upstream packaging, sidecars, updater and platform configuration.
process.exitCode = runTauriCommand([
  "build",
  "--config",
  JSON.stringify({
    build: { beforeBuildCommand: "node korean/build.mjs" },
  }),
  ...process.argv.slice(2),
]);
