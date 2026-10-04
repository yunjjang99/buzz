import { defineConfig } from "@playwright/test";
import { desktopRoot } from "../overlay.mjs";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  workers: 1,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "mobile-safari",
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.BUZZ_WEB_TEST_URL ?? "http://127.0.0.1:4180/chat/",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 850 },
  },
  webServer: process.env.BUZZ_WEB_TEST_URL
    ? undefined
    : {
        command: "pnpm exec vite --config korean/web/vite.config.ts",
        cwd: desktopRoot,
        url: "http://127.0.0.1:4180/chat/",
        reuseExistingServer: false,
      },
});
