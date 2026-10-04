import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nativeBuildArguments,
  nativeBuildConfig,
} from "./native-build-config.mjs";

test("employee build isolates app data, keyring/nest identity, deep links and instance identity", () => {
  const build = nativeBuildConfig(["--bundles", "app"]);
  assert.equal(build.config.identifier, "kr.kovar.buzz.desktop");
  assert.notEqual(build.config.identifier, "xyz.block.buzz.app");
  assert.equal(build.config.productName, "Kovar Buzz");
  assert.equal(build.slug, "kovar-accounts");
  assert.equal(build.config.bundle.createUpdaterArtifacts, false);
  assert.deepEqual(build.config.plugins.updater.endpoints, []);
  assert.deepEqual(build.config.plugins["deep-link"].desktop.schemes, [
    `buzz-demo-${build.slug}`,
  ]);
  assert.deepEqual(build.args, ["--bundles", "app"]);
});

test("owner migration explicitly opts into the existing upstream identity", () => {
  const build = nativeBuildConfig(["--shared-identity", "--bundles", "app"]);
  assert.equal(build.slug, null);
  assert.equal(build.config.identifier, undefined);
  assert.equal(build.config.plugins, undefined);
  assert.deepEqual(build.args, ["--bundles", "app"]);
});

test("platform config cannot replace the Kovar frontend or identity, including Cargo passthrough", () => {
  const build = nativeBuildConfig([
    "--config",
    "src-tauri/tauri.windows.conf.json",
    "--",
    "--locked",
  ]);
  const args = nativeBuildArguments(build);
  assert.deepEqual(args.slice(-2), ["--", "--locked"]);
  const lastConfig = JSON.parse(args[args.lastIndexOf("--config") + 1]);
  assert.equal(lastConfig.build.beforeBuildCommand, "node korean/build.mjs");
  assert.equal(lastConfig.identifier, "kr.kovar.buzz.desktop");
  assert.deepEqual(lastConfig.plugins.updater.endpoints, []);
});
