import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { options, newReport, saveReport } from "./common.mjs";

/** Validate a human-declared combination; this is a record, never a deployment executor. */
export function validateCombination(record) {
  if (
    record.schema !== 1 ||
    !["planned", "deployed", "rolled-back"].includes(record.status)
  )
    throw new Error("Invalid combination schema/status");
  const text = (value) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !/REPLACE|\n|\r/.test(value);
  const sha = (value, size) =>
    new RegExp(`^[a-f0-9]{${size}}$`).test(value ?? "");
  for (const key of [
    "environment",
    "operator",
    "changeRecord",
    "previousCombinationRecord",
  ])
    if (!text(record[key]))
      throw new Error(`Required public record field: ${key}`);
  for (const kind of ["macApp", "windowsApp", "web"]) {
    const entry = record.components?.[kind];
    if (
      kind !== "web" &&
      entry?.kovarSha === "not-deployed" &&
      entry?.buildManifestSha256 === "not-deployed"
    )
      continue;
    if (!sha(entry?.kovarSha, 40) || !sha(entry?.buildManifestSha256, 64))
      throw new Error(`Missing exact build identity: ${kind}`);
  }
  for (const kind of ["login", "relay"]) {
    const entry = record.components?.[kind];
    const registryDigest =
      /^[a-z0-9./_-]+(?::[a-zA-Z0-9._-]+)?@sha256:[a-f0-9]{64}$/.test(
        entry?.image ?? "",
      );
    const archivedLocalImage =
      /^sha256:[a-f0-9]{64}$/.test(entry?.image ?? "") &&
      sha(entry?.archiveSha256, 64);
    if (
      (!registryDigest && !archivedLocalImage) ||
      !sha(entry?.[kind === "relay" ? "upstreamSha" : "kovarSha"], 40)
    )
      throw new Error(
        `Require immutable image digest (or local ID + archive checksum) and source SHA: ${kind}`,
      );
  }
  for (const [section, keys] of Object.entries({
    database: [
      "beforeSchema",
      "afterSchema",
      "migrationReview",
      "backupReference",
      "restoreDrillReference",
    ],
    accounts: ["pairedBackupReference", "restoreDrillReference"],
    verification: [
      "upstreamCi",
      "kovarValidation",
      "humanPlatformTests",
      "signing",
    ],
  }))
    for (const key of keys)
      if (!text(record[section]?.[key]))
        throw new Error(
          `Required recovery/verification evidence: ${section}.${key}`,
        );
  if (
    !["restore-matched-database", "verified-backward-compatible"].includes(
      record.database.rollbackMode,
    )
  )
    throw new Error("Explicit database rollback decision required");
  return record;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = options(["--input", "--output"]);
  if (fs.statSync(args["--input"]).size > 64 * 1024)
    throw new Error(
      "Combination record exceeds 64KiB; never include account data or secrets",
    );
  const record = validateCombination(
    JSON.parse(fs.readFileSync(args["--input"], "utf8")),
  );
  const output = newReport(args["--output"]);
  record.recordedAt = new Date().toISOString();
  saveReport(
    output,
    "combination",
    record,
    `# Kovar 배포 조합 기록\n\n운영자 선언 상태: ${record.status}\n환경: ${record.environment}\n변경 기록: ${record.changeRecord}\n\n정확한 조합·백업·검증 참조는 combination.json에 있습니다. 이 명령은 서버를 조회하거나 배포하지 않았으며 선언 내용의 실제 수행을 증명하지 않습니다.`,
  );
  console.log(
    `Recorded public version references: ${path.join(output, "combination.json")}`,
  );
}
