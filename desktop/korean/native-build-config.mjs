/** Keep the employee app's persistent identity separate from the upstream Buzz app. */
export function nativeBuildConfig(args) {
  const shared = args.includes("--shared-identity");
  return {
    args: args.filter((arg) => arg !== "--shared-identity"),
    slug: shared ? null : "kovar-accounts",
    config: {
      build: { beforeBuildCommand: "node korean/build.mjs" },
      bundle: { createUpdaterArtifacts: false },
      ...(shared
        ? {}
        : {
            productName: "Kovar Buzz",
            identifier: "kr.kovar.buzz.desktop",
            plugins: {
              updater: { endpoints: [] },
              "deep-link": {
                desktop: { schemes: ["buzz-demo-kovar-accounts"] },
              },
            },
          }),
    },
  };
}

/** Apply Kovar identity/frontend policy after platform configs, before Cargo arguments. */
export function nativeBuildArguments(build) {
  const args = ["build", ...build.args];
  const delimiter = args.indexOf("--");
  args.splice(
    delimiter === -1 ? args.length : delimiter,
    0,
    "--config",
    JSON.stringify(build.config),
  );
  return args;
}
