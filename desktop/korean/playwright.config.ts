import { defineConfig } from "@playwright/test";
import upstream from "../playwright.config";
import { desktopRoot } from "./overlay.mjs";

export default defineConfig({
  ...upstream,
  testDir: "./tests",
  projects: [
    {
      name: "korean",
      testMatch: [
        "**/korean-locale.spec.ts",
        "**/native-account.spec.ts",
        "**/settings-details.spec.ts",
      ],
    },
  ],
  webServer: {
    command: "python3 -m http.server 4174 -d dist",
    cwd: desktopRoot,
    reuseExistingServer: false,
    url: "http://127.0.0.1:4174",
  },
  use: { ...upstream.use, baseURL: "http://127.0.0.1:4174" },
});
