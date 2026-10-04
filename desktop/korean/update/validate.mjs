import path from "node:path";
import fs from "node:fs";
import {
  desktop,
  root,
  options,
  newReport,
  saveReport,
  sourceIdentity,
  state,
} from "./common.mjs";
import { command } from "./process.mjs";

const args = options(["--suite", "--output"]);
const suite = args["--suite"] ?? "all";
if (!["ui", "relay", "all"].includes(suite) || !args["--output"])
  throw new Error(
    "Usage: validate.mjs --suite all|ui|relay --output NEW_DIRECTORY",
  );
const output = newReport(args["--output"]);
const report = {
  schema: 1,
  source: sourceIdentity(),
  upstream: state,
  suite,
  startedAt: new Date().toISOString(),
  checks: {},
  result: "failed",
  eligibleForRelease: false,
  limitations: [
    "Native macOS runtime: manual test required",
    "Native Windows runtime: manual test required",
    "Physical iOS/Android browser: manual test required",
    "Flutter native: Kovar accounts unsupported",
    "Signing/notarization and upstream CI: separate gates",
  ],
};
const env = { ...process.env, VITE_BUZZ_EMPLOYEE_APP: "1" };
// Never let an inherited URL redirect browser tests to production.
for (const name of Object.keys(env))
  if (/^(BUZZ_|VITE_BUZZ_)/.test(name) && name !== "VITE_BUZZ_EMPLOYEE_APP")
    delete env[name];
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const steps = [];
const node = (name, argv) => steps.push([name, process.execPath, argv]);
const p = (name, argv) => steps.push([name, pnpm, argv]);
if (suite !== "relay") {
  node("overlay-and-transformed-types", ["korean/check.mjs"]);
  node("overlay-regressions", [
    "--test",
    "korean/tests/overlay.test.mjs",
    "korean/native-build-config.test.mjs",
    "korean/update/update.test.mjs",
  ]);
  node("locale-unit", [
    "--import",
    "./test-jsdom-setup.mjs",
    "--import",
    "./test-loader.mjs",
    "--experimental-strip-types",
    "--test-force-exit",
    "--test",
    "korean/runtime/locale.jsdom-test.mjs",
  ]);
  node("account-and-protocol-unit", [
    "--import",
    "./test-loader.mjs",
    "--experimental-strip-types",
    "--test",
    "korean/runtime/native-enrollment.test.mjs",
    "korean/web/tests/protocol.test.mjs",
    "korean/web/login-service/service.test.mjs",
  ]);
  p("web-types", ["exec", "tsc", "-p", "korean/web/tsconfig.json"]);
  node("employee-e2e-build", ["korean/build.mjs", "--e2e"]);
  p("desktop-ui", [
    "exec",
    "playwright",
    "test",
    "--config",
    "korean/playwright.config.ts",
  ]);
  p("web-mobile-ui", [
    "exec",
    "playwright",
    "test",
    "--config",
    "korean/web/playwright.config.ts",
  ]);
  p("web-production-build", [
    "exec",
    "vite",
    "build",
    "--config",
    "korean/web/vite.config.ts",
  ]);
  p("login-production-build", [
    "exec",
    "vite",
    "build",
    "--config",
    "korean/web/login-service/vite.config.ts",
  ]);
  steps.push([
    "bundled-login-service",
    process.execPath,
    [
      "--import",
      "./test-loader.mjs",
      "--experimental-strip-types",
      "--test",
      "korean/web/login-service/service.test.mjs",
    ],
    { ...env, BUZZ_LOGIN_TEST_BUILD: "1" },
  ]);
}
if (suite !== "ui")
  node("real-relay", [
    "--import",
    "./test-loader.mjs",
    "--experimental-strip-types",
    "korean/update/relay.mjs",
  ]);
for (const [name] of steps) report.checks[name] = "not-run";
try {
  for (const [name, executable, argv, customEnv] of steps) {
    console.log(`Kovar validation: ${name}`);
    report.checks[name] = "failed";
    const log = fs.openSync(path.join(output, `${name}.log`), "w");
    try {
      await command(executable, argv, {
        cwd: desktop,
        env: customEnv ?? env,
        timeout: name === "real-relay" ? 60 * 60_000 : 20 * 60_000,
        onOutput: (data) => fs.writeSync(log, data),
      });
    } finally {
      fs.closeSync(log);
    }
    report.checks[name] = "passed";
  }
  report.result = "passed";
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  const after = sourceIdentity(root);
  if (
    after.sha !== report.source.sha ||
    after.tree !== report.source.tree ||
    after.dirty
  ) {
    report.source.dirty = true;
    report.eligibleForRelease = false;
  }
  saveReport(
    output,
    "validation",
    report,
    `# Kovar 검증\n\n- 소스: ${report.source.sha}\n- Dirty: ${report.source.dirty}\n- Suite: ${suite}\n- 결과: ${report.result}\n\n| 검사 | 결과 |\n|---|---|\n${Object.entries(
      report.checks,
    )
      .map(([name, status]) => `| ${name} | ${status} |`)
      .join(
        "\n",
      )}\n\n${report.error ?? ""}\n\n미검증 항목:\n${report.limitations.map((item) => `- ${item}`).join("\n")}\n\nMock UI 통과는 real-relay 통과를 대신하지 않습니다. Dirty 소스 보고서는 빌드 승격에 사용할 수 없습니다.`,
  );
  console.log(`Report: ${path.join(output, "validation.md")}`);
}
