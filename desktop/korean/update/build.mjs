import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  root,
  desktop,
  state,
  json,
  git,
  options,
  newReport,
  sourceIdentity,
  saveReport,
} from "./common.mjs";
import { command } from "./process.mjs";
import { requireEvidence } from "./gates.mjs";
import { nativeBuildConfig } from "../native-build-config.mjs";

const args = options(["--target", "--ui-report", "--relay-report", "--output"]);
const target = args["--target"];
if (
  ![
    "web",
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "x86_64-pc-windows-msvc",
  ].includes(target)
)
  throw new Error(
    "Choose --target web, aarch64-apple-darwin, x86_64-apple-darwin or x86_64-pc-windows-msvc",
  );
const source = sourceIdentity();
const evidence = [
  ...new Set([args["--ui-report"], args["--relay-report"]].filter(Boolean)),
].map(json);
const checks = requireEvidence(evidence, source);
git(["merge-base", "--is-ancestor", state.upstreamSha, source.sha]);
const buildConfig = nativeBuildConfig([]);
if (
  buildConfig.slug !== state.accountStore ||
  buildConfig.config.identifier !== state.appIdentifier
)
  throw new Error("Persistent application identity changed");
if (
  json(path.join(desktop, "korean/manifest.json")).baseCommit !==
  state.upstreamSha
)
  throw new Error("Overlay and applied upstream SHA disagree");
const output = newReport(args["--output"]);
const report = {
  schema: 1,
  builtAt: new Date().toISOString(),
  source,
  upstream: state,
  target,
  appVersion: json(path.join(desktop, "package.json")).version,
  identity: {
    identifier: state.appIdentifier,
    accountStore: state.accountStore,
  },
  checks,
  signing: "unsigned; no distribution signing or notarization",
  status: "failed",
  eligibleForRelease: false,
  pending: [
    "upstream CI on this exact commit",
    "human native/platform smoke test",
    "distribution signing/notarization",
    "deployment combination and backup review",
  ],
  artifacts: [],
};
const env = { ...process.env };
for (const name of Object.keys(env))
  if (
    /^(BUZZ_|VITE_BUZZ_|TAURI_|APPLE_)/.test(name) ||
    name === "CARGO_TARGET_DIR"
  )
    delete env[name];
Object.assign(env, {
  BUZZ_RELAY_URL: "wss://buzz.kovar.kr",
  BUZZ_RELAY_HTTP: "https://buzz.kovar.kr",
  VITE_BUZZ_EMPLOYEE_APP: "1",
});
const exec = (executable, argv, cwd = root) =>
  command(executable, argv, { cwd, env, timeout: 90 * 60_000 });
const node = (argv) => exec(process.execPath, argv, desktop);
const vite = path.join(
  path.dirname(fileURLToPath(import.meta.resolve("vite/package.json"))),
  "bin/vite.js",
);
try {
  // Re-run the production overlay/type guard even with prior evidence.
  await node(["korean/check.mjs"]);
  if (target === "web") {
    await node([vite, "build", "--config", "korean/web/vite.config.ts"]);
    await node([
      vite,
      "build",
      "--config",
      "korean/web/login-service/vite.config.ts",
    ]);
    fs.cpSync(path.join(desktop, "korean/web-dist"), path.join(output, "web"), {
      recursive: true,
    });
    fs.cpSync(
      path.join(desktop, "korean/login-dist"),
      path.join(output, "login"),
      { recursive: true },
    );
    fs.copyFileSync(
      path.join(desktop, "korean/web/login-service/Dockerfile"),
      path.join(output, "login/Dockerfile"),
    );
  } else {
    const windows = target.endsWith("windows-msvc");
    if (
      (windows && process.platform !== "win32") ||
      (!windows && process.platform !== "darwin")
    )
      throw new Error("Use a native build host for the selected platform");
    const packages = [
      "buzz-acp",
      "buzz-agent",
      "buzz-dev-mcp",
      "git-credential-nostr",
      "buzz-cli",
      ...(!windows ? ["buzz-backend-kubernetes"] : []),
    ];
    await exec("cargo", [
      "build",
      "--locked",
      "--release",
      "--target",
      target,
      ...packages.flatMap((p) => ["-p", p]),
    ]);
    await exec("bash", ["scripts/bundle-sidecars.sh", target]);
    // Isolate native package output from upstream builds; sidecars above use upstream layout.
    env.CARGO_TARGET_DIR = path.join(root, "target/kovar-native", target);
    const bundle = path.join(env.CARGO_TARGET_DIR, target, "release/bundle");
    fs.rmSync(bundle, { recursive: true, force: true });
    await node([
      "korean/native-build.mjs",
      "--no-sign",
      "--target",
      target,
      "--bundles",
      windows ? "nsis" : "app",
      ...(windows ? ["--config", "src-tauri/tauri.windows.conf.json"] : []),
    ]);
    if (windows) {
      const installers = fs
        .readdirSync(path.join(bundle, "nsis"))
        .filter((name) => name.endsWith(".exe"));
      if (installers.length !== 1)
        throw new Error("Expected one newly built Kovar NSIS installer");
      fs.copyFileSync(
        path.join(bundle, "nsis", installers[0]),
        path.join(
          output,
          `Kovar-Buzz-${report.appVersion}-${source.sha.slice(0, 12)}-${target}-unsigned.exe`,
        ),
      );
    } else {
      const app = path.join(bundle, "macos/Kovar Buzz.app");
      if (!fs.existsSync(app))
        throw new Error("Kovar application bundle missing");
      await exec("ditto", [
        "-c",
        "-k",
        "--sequesterRsrc",
        "--keepParent",
        app,
        path.join(
          output,
          `Kovar-Buzz-${report.appVersion}-${source.sha.slice(0, 12)}-${target}-unsigned.zip`,
        ),
      ]);
    }
  }
  const walk = async (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const hash = createHash("sha256");
        for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
        report.artifacts.push({
          path: path.relative(output, file).split(path.sep).join("/"),
          bytes: fs.statSync(file).size,
          sha256: hash.digest("hex"),
        });
      } else throw new Error(`Unexpected artifact entry: ${file}`);
    }
  };
  await walk(output);
  if (!report.artifacts.length) throw new Error("No build artifacts produced");
  const after = sourceIdentity();
  if (after.dirty || after.sha !== source.sha || after.tree !== source.tree)
    throw new Error("Source changed during build");
  report.status = "unsigned-candidate";
  fs.writeFileSync(
    path.join(output, "SHA256SUMS"),
    report.artifacts.map((item) => `${item.sha256}  ${item.path}`).join("\n") +
      "\n",
  );
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  saveReport(
    output,
    "build",
    report,
    `# Kovar build\n\n- Status: ${report.status}\n- Source: ${source.sha}\n- Upstream: ${state.upstreamTag ?? state.sourceKind} / ${state.upstreamSha}\n- Version: ${report.appVersion}\n- Target: ${target}\n- Signing: ${report.signing}\n- Release eligible: false\n\n${report.error ?? ""}\n\n${report.pending.map((p) => `- ${p}`).join("\n")}\n\nChecks and artifact SHA-256: build.json / SHA256SUMS. This command does not deploy or publish.`,
  );
  console.log(`Report: ${path.join(output, "build.md")}`);
}
