import { runTauriCommand } from "../scripts/tauri-command.mjs";
import { nativeBuildConfig } from "./native-build-config.mjs";

const build = nativeBuildConfig(process.argv.slice(2));
// Upstream's named identity isolates keyring, nest, OAuth caches and legacy
// migration. The distinct Tauri identifier also isolates webview/app storage
// and the single-instance lock. Pin both so ambient build flags cannot revert it.
if (build.slug) {
  process.env.BUZZ_BUILD_DEMO_SLUG = build.slug;
  process.env.VITE_BUZZ_EMPLOYEE_APP = "1";
  delete process.env.BUZZ_BUILD_AUTO_CONNECT_DEFAULT_RELAY;
} else {
  delete process.env.BUZZ_BUILD_DEMO_SLUG;
  delete process.env.VITE_BUZZ_EMPLOYEE_APP;
}
process.exitCode = runTauriCommand([
  "build",
  "--config",
  JSON.stringify(build.config),
  ...build.args,
]);
