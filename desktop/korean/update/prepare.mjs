import fs from "node:fs";
import path from "node:path";
import {
  root,
  state,
  git,
  run,
  json,
  options,
  newReport,
  sourceIdentity,
} from "./common.mjs";
import { checkOverlay } from "../overlay.mjs";
import { collisions } from "./upstream.mjs";

const args = options(["--report", "--output"]);
const report = json(args["--report"]);
const current = sourceIdentity();
if (
  current.dirty ||
  report.source?.dirty ||
  report.result !== "inspection-passed" ||
  report.source?.sha !== current.sha ||
  report.source?.tree !== current.tree
)
  throw new Error("Require a passing inspection of this exact clean source");
if (!/^[a-f0-9]{40}$/.test(report.targetSha) || report.mode === "baseline")
  throw new Error("Baseline is a rehearsal, not a new integration target");
const output = newReport(args["--output"]);
const destination = path.join(output, "repo");
// Independent object storage: this review workspace survives deletion of the original checkout.
run("git", ["clone", "--no-hardlinks", "--no-checkout", root, destination]);
try {
  git(["checkout", "-b", "codex/kovar-integration", current.sha], destination);
  git(
    ["remote", "set-url", "origin", git(["remote", "get-url", "origin"])],
    destination,
  );
  git(
    ["remote", "add", "upstream", "https://github.com/block/buzz.git"],
    destination,
  );
  git(["fetch", "--no-tags", "upstream", report.targetSha], destination);
  if (
    git(["rev-parse", "FETCH_HEAD^{commit}"], destination) !== report.targetSha
  )
    throw new Error("Fetched SHA differs from inspected target");
  const owned = git(
    ["diff", "--name-only", "--diff-filter=A", state.upstreamSha, current.sha],
    destination,
  ).split("\n");
  if (
    collisions(
      git(
        ["ls-tree", "-r", "--name-only", report.targetSha],
        destination,
      ).split("\n"),
      owned,
    ).length
  )
    throw new Error("Upstream owns Kovar paths");
  git(
    [
      "-c",
      "core.hooksPath=/dev/null",
      "merge",
      "--no-commit",
      "--no-ff",
      report.targetSha,
    ],
    destination,
  );
  if (git(["write-tree"], destination) !== report.integratedTree)
    throw new Error("Integrated tree differs from inspected tree");
  checkOverlay((filename) =>
    fs.readFileSync(
      path.join(destination, path.relative(root, filename)),
      "utf8",
    ),
  );
  const next = {
    ...state,
    upstreamSha: report.targetSha,
    upstreamTag: report.release?.tag ?? null,
    sourceKind: report.mode === "release" ? "release" : "main-snapshot",
  };
  fs.writeFileSync(
    path.join(destination, "desktop/korean/update/state.json"),
    `${JSON.stringify(next, null, 2)}\n`,
  );
  const manifestPath = path.join(destination, "desktop/korean/manifest.json");
  const manifest = json(manifestPath);
  manifest.baseCommit = next.upstreamSha;
  manifest.baseVersion = json(
    path.join(destination, "desktop/package.json"),
  ).version;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.copyFileSync(args["--report"], path.join(output, "inspection.json"));
  console.log(
    `Prepared: ${destination}\nReview the merge and state/manifest changes, then git add those files and git commit -s. Install dependencies and run validation there. Original branch and production are unchanged.`,
  );
} catch (error) {
  // Preserve conflicts for review. Never silently abort or reset the human's review workspace.
  fs.writeFileSync(
    path.join(output, "FAILED.txt"),
    `${error.message}\nDo not build or deploy this workspace. Original checkout unchanged.\n`,
  );
  throw error;
}
