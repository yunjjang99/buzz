/** Keep the employee app's persistent identity separate from the upstream Buzz app. */
export function nativeBuildConfig(args) {
  const shared = args.includes("--shared-identity");
  return {
    args: args.filter((arg) => arg !== "--shared-identity"),
    slug: shared ? null : "kovar-accounts",
    config: {
      build: { beforeBuildCommand: "node korean/build.mjs" },
      ...(shared
        ? {}
        : {
            productName: "Kovar Buzz",
            identifier: "kr.kovar.buzz.desktop",
            plugins: {
              "deep-link": {
                desktop: { schemes: ["buzz-demo-kovar-accounts"] },
              },
            },
          }),
    },
  };
}
