import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { root, desktop, sourceIdentity, json } from "./update/common.mjs";
import { command } from "./update/process.mjs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log(
    "Windows local test installer: node desktop/korean/build-windows.mjs --output NEW_DIRECTORY\nRequires Windows x64/MSVC, Node 24, pnpm install --frozen-lockfile, Git and Rust.\nCreates an unsigned EXE, build.json and SHA256SUMS; does not publish or install.",
  );
  process.exit(0);
}
if (args.length !== 2 || args[0] !== "--output")
  throw new Error("Use --output NEW_DIRECTORY (see --help)");
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error(
    "Run on Windows x64 with the MSVC toolchain; Mac/WSL are unsupported.",
  );
const source = sourceIdentity();
if (source.dirty)
  throw new Error(
    "Commit or separately preserve local edits before building; source must be clean.",
  );
const output = path.resolve(args[1]);
const relative = path.relative(root, output);
if (
  !relative.startsWith(`..${path.sep}`) &&
  relative !== ".." &&
  !path.isAbsolute(relative)
)
  throw new Error("Choose an output directory outside the source checkout.");
fs.mkdirSync(output); // Refuse to overwrite an existing release folder.
const target = "x86_64-pc-windows-msvc";
const nativeTarget = path.join(root, "target/kovar-windows");
fs.mkdirSync(nativeTarget, { recursive: true });
const lock = path.join(nativeTarget, "build.lock");
const lockFd = fs.openSync(lock, "wx");
fs.writeFileSync(lockFd, `${process.pid}\n`);
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
  CMAKE_POLICY_VERSION_MINIMUM: "3.5",
});
const report = {
  source,
  target,
  appVersion: json(path.join(desktop, "package.json")).version,
  startedAt: new Date().toISOString(),
  status: "failed",
  signing: "unsigned; no Authenticode certificate",
  eligibleForRelease: false,
  pending: [
    "Windows installation, restart, IME, keyring and MFA tests",
    "full compatibility/real-relay and upstream CI",
    "distribution signing",
  ],
};
const log = fs.openSync(path.join(output, "build.log"), "wx");
const run = (exe, argv, cwd = root) =>
  command(exe, argv, {
    cwd,
    env,
    timeout: 90 * 60_000,
    onOutput(data) {
      fs.writeSync(log, data);
      process.stdout.write(data);
    },
  });
try {
  await run("git", ["--version"]);
  await run("cargo", ["--version"]);
  await run(process.execPath, ["--version"]);
  await run(
    process.execPath,
    ["--test", "korean/native-build-config.test.mjs"],
    desktop,
  );
  await run(
    process.execPath,
    [
      "--test",
      "korean/web/login-service/mfa.test.mjs",
      "korean/web/login-service/service.test.mjs",
    ],
    desktop,
  );
  const packages = [
    "buzz-acp",
    "buzz-agent",
    "buzz-dev-mcp",
    "git-credential-nostr",
    "buzz-cli",
  ];
  await run("cargo", [
    "build",
    "--locked",
    "--release",
    "--target",
    target,
    ...packages.flatMap((p) => ["-p", p]),
  ]);
  const sidecars = path.join(desktop, "src-tauri/binaries");
  fs.mkdirSync(sidecars, { recursive: true });
  for (const bin of [
    "buzz-acp",
    "buzz-agent",
    "buzz-dev-mcp",
    "git-credential-nostr",
    "buzz",
  ])
    fs.copyFileSync(
      path.join(root, "target", target, "release", `${bin}.exe`),
      path.join(sidecars, `${bin}-${target}.exe`),
    );
  env.CARGO_TARGET_DIR = nativeTarget;
  const nsis = path.join(nativeTarget, target, "release/bundle/nsis");
  // Only this wrapper's generated installer output is cleared, under its build lock.
  fs.rmSync(nsis, { recursive: true, force: true });
  await run(
    process.execPath,
    [
      "korean/native-build.mjs",
      "--no-sign",
      "--target",
      target,
      "--bundles",
      "nsis",
      "--config",
      "src-tauri/tauri.windows.conf.json",
      "--",
      "--locked",
    ],
    desktop,
  );
  const installers = fs
    .readdirSync(nsis)
    .filter((name) => name.endsWith(".exe"));
  if (installers.length !== 1)
    throw new Error("Expected exactly one newly built NSIS installer");
  const after = sourceIdentity();
  if (after.dirty || after.sha !== source.sha || after.tree !== source.tree)
    throw new Error("Source changed during the build");
  const name = `Kovar-Buzz-${report.appVersion}-${source.sha.slice(0, 12)}-windows-x64-unsigned.exe`;
  const destination = path.join(output, name);
  fs.copyFileSync(path.join(nsis, installers[0]), destination);
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(destination))
    hash.update(chunk);
  report.artifact = {
    name,
    bytes: fs.statSync(destination).size,
    sha256: hash.digest("hex"),
  };
  fs.writeFileSync(
    path.join(output, "SHA256SUMS"),
    `${report.artifact.sha256}  ${name}\n`,
  );
  report.status = "unsigned-local-test-build";
  console.log(`\nInstaller and checksums: ${output}`);
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  fs.closeSync(log);
  fs.closeSync(lockFd);
  fs.unlinkSync(lock);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(output, "build.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (report.error) console.error(report.error);
}
