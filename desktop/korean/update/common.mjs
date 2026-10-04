import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const desktop = path.join(root, "desktop");
export const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export const state = json(path.join(root, "desktop/korean/update/state.json"));

/** Bound command duration and captured output; never interpolate through a shell. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    const error = new Error(
      `${command} failed (${result.status ?? result.error?.code}):\n${result.stderr ?? ""}\n${result.stdout ?? ""}`,
    );
    throw error;
  }
  return options.trim === false
    ? (result.stdout ?? "")
    : (result.stdout?.trim() ?? "");
}
export const git = (args, cwd = root) => run("git", args, { cwd });

/** Record exact committed source and flag any uncommitted or untracked work. */
export function sourceIdentity(cwd = root) {
  return {
    sha: git(["rev-parse", "HEAD"], cwd),
    tree: git(["rev-parse", "HEAD^{tree}"], cwd),
    dirty: Boolean(
      git(["status", "--porcelain", "--untracked-files=normal"], cwd),
    ),
  };
}

/** Reports are a new directory, so previous evidence cannot silently survive a failed run. */
export function newReport(directory) {
  fs.mkdirSync(directory, { recursive: false });
  return path.resolve(directory);
}
export function saveReport(directory, name, report, markdown) {
  fs.writeFileSync(
    path.join(directory, `${name}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(directory, `${name}.md`), `${markdown}\n`);
}
export function options(names) {
  const result = {};
  const args = process.argv.slice(2);
  while (args.length) {
    const key = args.shift();
    if (!names.includes(key) || !args.length || args[0].startsWith("--"))
      throw new Error(
        `Expected ${names.join(", ")} with values; unknown/missing: ${key}`,
      );
    if (key in result) throw new Error(`Duplicate option: ${key}`);
    result[key] = args.shift();
  }
  return result;
}
