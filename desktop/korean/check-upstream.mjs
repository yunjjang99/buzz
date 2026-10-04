import { execFileSync } from "node:child_process";
import path from "node:path";
import { checkOverlay, desktopRoot } from "./overlay.mjs";

const ref = process.argv[2];
if (!ref || ref.startsWith("-") || !/^[a-zA-Z0-9_./-]+$/.test(ref)) {
  throw new Error(
    "Usage: node korean/check-upstream.mjs upstream/main (or desktop-v0.5.26)",
  );
}
const repository = path.dirname(desktopRoot);
function git(args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  });
}
const commit = git([
  "rev-parse",
  "--verify",
  "--end-of-options",
  `${ref}^{commit}`,
]).trim();
const collisions = git([
  "ls-tree",
  "-r",
  "--name-only",
  commit,
  "--",
  "desktop/korean",
  "docs/korean-desktop.md",
]).trim();
if (collisions)
  throw new Error(
    `Upstream now owns overlay paths; review before merging:\n${collisions}`,
  );
const count = checkOverlay((filename) => {
  const relative = path
    .relative(repository, filename)
    .split(path.sep)
    .join("/");
  return git(["show", `${commit}:${relative}`]);
});
console.log(
  `${ref} (${commit.slice(0, 12)}): ${count} Korean UI bindings compatible; no overlay path collisions. No files, branches, app or server were changed. Build and app testing are still required after merging.`,
);
