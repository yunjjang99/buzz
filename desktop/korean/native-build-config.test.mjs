import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeBuildConfig } from "./native-build-config.mjs";

test("employee build isolates app data, keyring/nest identity, deep links and instance identity", () => {
  const build = nativeBuildConfig(["--bundles", "app"]);
  assert.equal(build.config.identifier, "kr.kovar.buzz.desktop");
  assert.notEqual(build.config.identifier, "xyz.block.buzz.app");
  assert.equal(build.config.productName, "Kovar Buzz");
  assert.equal(build.slug, "kovar-accounts");
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
