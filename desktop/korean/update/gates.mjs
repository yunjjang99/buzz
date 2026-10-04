/** Every required check is explicit: an empty/partial report can never authorize a candidate. */
export const requiredChecks = [
  "overlay-and-transformed-types",
  "overlay-regressions",
  "locale-unit",
  "account-and-protocol-unit",
  "web-types",
  "employee-e2e-build",
  "desktop-ui",
  "web-mobile-ui",
  "web-production-build",
  "login-production-build",
  "bundled-login-service",
  "real-relay",
];
export function requireEvidence(reports, source) {
  if (source.dirty)
    throw new Error("Build requires a clean committed source tree");
  const checks = {};
  for (const report of reports) {
    if (
      report.schema !== 1 ||
      report.result !== "passed" ||
      report.source?.dirty ||
      report.source?.sha !== source.sha ||
      report.source?.tree !== source.tree
    )
      throw new Error(
        "Validation evidence is failed, dirty, or belongs to a different source",
      );
    for (const [name, result] of Object.entries(report.checks ?? {})) {
      if (result !== "passed")
        throw new Error(`Validation did not pass: ${name}`);
      checks[name] = result;
    }
  }
  for (const name of requiredChecks)
    if (checks[name] !== "passed")
      throw new Error(`Missing required validation: ${name}`);
  return checks;
}
