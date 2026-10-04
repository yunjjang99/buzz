import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collisions, selectRelease } from "./upstream.mjs";
import { command } from "./process.mjs";

const release = (tag, published = "2026-09-01T00:00:00Z", extra = {}) => ({
  tag_name: tag,
  published_at: published,
  draft: false,
  prerelease: false,
  html_url: `https://github.com/block/buzz/releases/tag/${tag}`,
  ...extra,
});
test("official release selection excludes mobile, relay, draft and prerelease even when newer", () => {
  const releases = [
    release("mobile-v99.0.0", "2026-10-01"),
    release("v99.0.0", "2026-10-01"),
    release("desktop-v0.5.26"),
    release("desktop-v0.5.27", "2026-10-01", { draft: true }),
    release("desktop-v0.5.28", "2026-10-01", { prerelease: true }),
    release("desktop-v0.5.25", "2026-08-01"),
  ];
  assert.equal(selectRelease(releases).tag, "desktop-v0.5.26");
  assert.equal(
    selectRelease(releases, "desktop-v0.5.25").tag,
    "desktop-v0.5.25",
  );
  assert.throws(
    () => selectRelease(releases, "desktop-v0.5.27"),
    /No matching/,
  );
  assert.throws(() => selectRelease(releases, "main"), /official/);
  assert.throws(() => selectRelease([]), /No matching/);
});
test("owned-path collision guard covers files, directory ancestors and additions", () => {
  assert.deepEqual(
    collisions(
      [
        "desktop/korean/new.ts",
        "docs/kovar-updates.md",
        "docs",
        "desktop/src/main.tsx",
      ],
      ["docs/kovar-updates.md"],
    ),
    ["desktop/korean/new.ts", "docs/kovar-updates.md", "docs"],
  );
  assert.deepEqual(
    collisions(
      ["desktop/src/main.tsx", "web/main.ts"],
      ["docs/kovar-updates.md"],
    ),
    [],
  );
});
test("command runner propagates nonzero status and terminates a timed-out process group", async () => {
  await assert.rejects(
    command(process.execPath, ["-e", "process.exit(7)"], { onOutput() {} }),
    /exited 7/,
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "kovar-process-test-"),
  );
  const marker = path.join(directory, "leaked");
  try {
    const child = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'leak'),900)`;
    await assert.rejects(
      command(
        process.execPath,
        [
          "-e",
          `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'});setTimeout(()=>{},10000)`,
        ],
        { timeout: 250, onOutput() {} },
      ),
      /Deadline/,
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("candidate gate rejects missing Kovar checks, mock-only relay, stale and dirty evidence", async () => {
  const { requireEvidence, requiredChecks } = await import("./gates.mjs");
  const source = { sha: "a".repeat(40), tree: "b".repeat(40), dirty: false };
  const report = {
    schema: 1,
    source,
    result: "passed",
    checks: Object.fromEntries(requiredChecks.map((key) => [key, "passed"])),
  };
  assert.equal(
    Object.keys(requireEvidence([report], source)).length,
    requiredChecks.length,
  );
  for (const key of requiredChecks) {
    const partial = structuredClone(report);
    delete partial.checks[key];
    assert.throws(() => requireEvidence([partial], source), /Missing required/);
  }
  assert.throws(
    () =>
      requireEvidence(
        [
          {
            ...report,
            checks: { ...report.checks, "real-relay": "mock-passed" },
          },
        ],
        source,
      ),
    /did not pass/,
  );
  assert.throws(
    () =>
      requireEvidence(
        [{ ...report, source: { ...source, sha: "c".repeat(40) } }],
        source,
      ),
    /different source/,
  );
  assert.throws(
    () => requireEvidence([report], { ...source, dirty: true }),
    /clean committed/,
  );
  assert.throws(
    () => requireEvidence([{ ...report, result: "failed" }], source),
    /failed/,
  );
});

test("combination records require paired account backup, database rollback decision and immutable images", async () => {
  const { validateCombination } = await import("./record.mjs");
  const candidate = {
    schema: 1,
    status: "planned",
    environment: "fixture.invalid",
    operator: "test",
    changeRecord: "test-change",
    previousCombinationRecord: "previous-record",
    components: {
      macApp: { kovarSha: "not-deployed", buildManifestSha256: "not-deployed" },
      windowsApp: {
        kovarSha: "not-deployed",
        buildManifestSha256: "not-deployed",
      },
      web: { kovarSha: "a".repeat(40), buildManifestSha256: "b".repeat(64) },
      login: {
        image: `example/login@sha256:${"c".repeat(64)}`,
        kovarSha: "a".repeat(40),
      },
      relay: {
        image: `example/relay@sha256:${"d".repeat(64)}`,
        upstreamSha: "e".repeat(40),
      },
    },
    database: {
      beforeSchema: "1",
      afterSchema: "2",
      migrationReview: "review-1",
      backupReference: "db-backup",
      restoreDrillReference: "drill-1",
      rollbackMode: "restore-matched-database",
    },
    accounts: {
      pairedBackupReference: "paired-backup-1",
      restoreDrillReference: "drill-2",
    },
    verification: {
      upstreamCi: "ci-1",
      kovarValidation: "test-1",
      humanPlatformTests: "human-1",
      signing: "unsigned",
    },
  };
  assert.equal(validateCombination(candidate), candidate);
  const missingPair = structuredClone(candidate);
  delete missingPair.accounts.pairedBackupReference;
  assert.throws(() => validateCombination(missingPair), /pairedBackup/);
  const mutable = structuredClone(candidate);
  mutable.components.relay.image = "example/relay:latest";
  assert.throws(() => validateCombination(mutable), /immutable/);
  assert.throws(
    () =>
      validateCombination({
        ...candidate,
        previousCombinationRecord: "REPLACE",
      }),
    /Required/,
  );
});

test("nested command runners remain in the outer cancellation group", async () => {
  if (process.platform === "win32") return;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "kovar-nested-test-"),
  );
  const marker = path.join(directory, "leaked");
  try {
    const leaf = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'leak'),900)`;
    const nested = `import { command } from ${JSON.stringify(new URL("./process.mjs", import.meta.url).href)}; await command(process.execPath,['-e',${JSON.stringify(leaf)}]);`;
    await assert.rejects(
      command(process.execPath, ["--input-type=module", "-e", nested], {
        timeout: 250,
        onOutput() {},
      }),
      /Deadline/,
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
