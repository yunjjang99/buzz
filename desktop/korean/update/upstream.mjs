import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkOverlay } from "../overlay.mjs";
import {
  git,
  root,
  run,
  state,
  newReport,
  options,
  saveReport,
  sourceIdentity,
} from "./common.mjs";

const desktopTag = /^desktop-v\d+\.\d+\.\d+$/;
/** Select published stable desktop releases, never the repository's generic latest release. */
export function selectRelease(releases, tag) {
  if (tag && !desktopTag.test(tag))
    throw new Error("Expected an official stable desktop-vX.Y.Z tag");
  const candidates = releases.filter(
    (r) =>
      !r.draft &&
      !r.prerelease &&
      r.published_at &&
      desktopTag.test(r.tag_name),
  );
  const found = tag
    ? candidates.find((r) => r.tag_name === tag)
    : candidates.sort(
        (a, b) => Date.parse(b.published_at) - Date.parse(a.published_at),
      )[0];
  if (!found)
    throw new Error("No matching published stable desktop release found");
  return {
    tag: found.tag_name,
    publishedAt: found.published_at,
    url: found.html_url,
  };
}
function releases(tag) {
  if (tag)
    return [
      JSON.parse(run("gh", ["api", `repos/block/buzz/releases/tags/${tag}`])),
    ];
  const result = [];
  for (let page = 1; page <= 20; page++) {
    const batch = JSON.parse(
      run("gh", ["api", `repos/block/buzz/releases?per_page=100&page=${page}`]),
    );
    result.push(...batch);
    if (batch.length < 100) return result;
  }
  throw new Error(
    "Release scan reached 2,000 entries; narrow to --tag (no partial selection)",
  );
}
/** Directory/file prefix collisions count even when Git could auto-merge the contents. */
export function collisions(upstreamPaths, ownedPaths) {
  return upstreamPaths.filter(
    (p) =>
      p === "desktop/korean" ||
      p.startsWith("desktop/korean/") ||
      ownedPaths.some(
        (owned) =>
          p === owned || p.startsWith(`${owned}/`) || owned.startsWith(`${p}/`),
      ),
  );
}
function overlayAt(cwd, commit) {
  return checkOverlay((filename) =>
    run(
      "git",
      [
        "show",
        `${commit}:${path.relative(root, filename).split(path.sep).join("/")}`,
      ],
      { cwd, trim: false },
    ),
  );
}

/** Rehearse using a private clone. No source branches, tags, app data or server are changed. */
export function inspect({ mode, tag, output, source = root }) {
  if (!["release", "main", "baseline"].includes(mode))
    throw new Error("--mode must be release, main or baseline");
  if (tag && (mode !== "release" || !desktopTag.test(tag)))
    throw new Error("--tag requires release mode and desktop-vX.Y.Z");
  const directory = newReport(output);
  const report = {
    schema: 1,
    checkedAt: new Date().toISOString(),
    mode,
    applied: state,
    source: sourceIdentity(source),
    release: null,
    targetSha: null,
    mergeBases: [],
    checks: {},
    eligibleForRelease: false,
  };
  let scratch;
  let stage = "source";
  try {
    if (report.source.dirty)
      throw new Error(
        "Commit or stash your own changes first; inspection only uses a clean committed snapshot",
      );
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "kovar-update-"));
    const repo = path.join(scratch, "repo");
    run("git", ["clone", "--shared", "--no-checkout", source, repo]);
    git(["checkout", "--detach", report.source.sha], repo);
    if (mode === "release") report.release = selectRelease(releases(tag), tag);
    if (mode !== "baseline") {
      const ref =
        mode === "main" ? "refs/heads/main" : `refs/tags/${report.release.tag}`;
      // Fetch directly from the official repository into this private clone, not local tags.
      git(
        ["fetch", "--no-tags", "https://github.com/block/buzz.git", ref],
        repo,
      );
    }
    report.targetSha = git(
      [
        "rev-parse",
        "--verify",
        mode === "baseline" ? state.upstreamSha : "FETCH_HEAD^{commit}",
      ],
      repo,
    );
    report.mergeBases = git(
      ["merge-base", "--all", state.upstreamSha, report.targetSha],
      repo,
    ).split("\n");
    report.changedFiles = git(
      ["diff", "--name-status", state.upstreamSha, report.targetSha],
      repo,
    )
      .split("\n")
      .filter(Boolean);
    report.migrations = report.changedFiles.filter((p) =>
      /\t(migrations\/|schema\/|scripts\/reconcile-schema)/.test(p),
    );
    report.checks.source = "passed";
    stage = "ownedPaths";
    const owned = git(
      [
        "diff",
        "--name-only",
        "--diff-filter=A",
        state.upstreamSha,
        report.source.sha,
      ],
      repo,
    )
      .split("\n")
      .filter(Boolean);
    report.collisions = collisions(
      git(["ls-tree", "-r", "--name-only", report.targetSha], repo).split("\n"),
      owned,
    );
    if (report.collisions.length)
      throw new Error(
        `Upstream owns Kovar paths:\n${report.collisions.join("\n")}`,
      );
    report.checks.ownedPaths = "passed";
    // Record both results even if the upstream release is an older divergent branch.
    stage = "gitMerge";
    git(
      [
        "-c",
        "user.name=Kovar inspection",
        "-c",
        "user.email=inspection@invalid",
        "-c",
        "core.hooksPath=/dev/null",
        "merge",
        "--no-commit",
        "--no-ff",
        report.targetSha,
      ],
      repo,
    );
    report.integratedTree = git(["write-tree"], repo);
    report.checks.gitMerge = "passed";
    stage = "targetOverlay";
    report.bindings = overlayAt(repo, report.targetSha);
    report.checks.targetOverlay = "passed";
    stage = "integratedOverlay";
    checkOverlay((filename) =>
      fs.readFileSync(path.join(repo, path.relative(root, filename)), "utf8"),
    );
    report.checks.integratedOverlay = "passed";
    report.result = "inspection-passed";
  } catch (error) {
    report.checks[stage] = "failed";
    report.error = error.message;
    report.result = "blocked";
  } finally {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    for (const key of [
      "source",
      "ownedPaths",
      "gitMerge",
      "targetOverlay",
      "integratedOverlay",
      "transformedTypes",
      "build",
      "features",
      "realRelay",
      "nativeMac",
      "nativeWindows",
    ])
      report.checks[key] ??= "not-run";
    const rows = Object.entries(report.checks)
      .map(([name, status]) => `| ${name} | ${status} |`)
      .join("\n");
    saveReport(
      directory,
      "upstream",
      report,
      `# Kovar 원본 업데이트 검사\n\n- 결과: ${report.result}\n- 모드: ${mode} (main/baseline은 정식 릴리스 아님)\n- 현재 기준: ${state.upstreamSha} / ${state.upstreamTag ?? "태그 없음: main snapshot"}\n- Kovar: ${report.source.sha}\n- 대상: ${report.release?.tag ?? mode} / ${report.targetSha ?? "선택 실패"}\n- 공통 조상: ${report.mergeBases.join(", ")}\n- 릴리스: ${report.release?.url ?? "해당 없음"}\n- 버전 문자열·커밋 개수로 출시 가능성을 판정하지 않음. 운영 유지.\n\n| 검사 | 결과 |\n|---|---|\n${rows}\n\n검사 통과는 출시 승인 아님. 격리 통합 후 validate/build와 실제 플랫폼 확인 필요.\n\n## 오류\n\n\`\`\`text\n${report.error ?? "없음"}\n\`\`\`\n\n## 변경 파일 (현재 원본 기준 → 대상)\n\n\`\`\`text\n${report.changedFiles?.join("\n") || "없음"}\n\`\`\`\n\nDB 관련 변경: ${report.migrations?.length ?? 0}개. 이미지 롤백과 DB 복구는 별도 검토.`,
    );
    console.log(
      `Report: ${path.join(directory, "upstream.md")} (${report.result})`,
    );
  }
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = options(["--mode", "--tag", "--output"]);
  if (!args["--output"]) throw new Error("Required: --output NEW_DIRECTORY");
  process.exitCode =
    inspect({
      mode: args["--mode"] ?? "release",
      tag: args["--tag"],
      output: args["--output"],
    }).result === "blocked"
      ? 1
      : 0;
}
