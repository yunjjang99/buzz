import { expect, test } from "@playwright/test";
import { installRelay, signInWithExtension } from "./fixtures";
import { waitForAnimations } from "../../../tests/helpers/animations";

test.beforeEach(async ({ page }) => {
  await page.route("**/chat-api/**", (route) =>
    route.fulfill({
      status: route.request().url().endsWith("/status") ? 200 : 401,
      contentType: "application/json",
      body: JSON.stringify(
        route.request().url().endsWith("/status")
          ? { configured: true, serverTime: Math.floor(Date.now() / 1000) }
          : { error: "login-required" },
      ),
    }),
  );
});

for (const mode of ["light", "dark"] as const) {
  test(`app palette, login and conversation in ${mode} mode`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: mode });
    await page.goto("/chat/");
    await expect(page.locator(".brand")).toContainText("Kovar Buzz");
    const surface = mode === "light" ? "rgb(255, 255, 255)" : "rgb(26, 26, 26)";
    await expect(page.locator(".login-card")).toHaveCSS(
      "background-color",
      surface,
    );
    await waitForAnimations(page);
    await page.screenshot({ path: testInfo.outputPath(`login-${mode}.png`) });
    await installRelay(page);
    await signInWithExtension(page);
    await expect(page.locator(".conversation")).toHaveCSS(
      "background-color",
      surface,
    );
    await expect(page.locator(".sidebar")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(page.locator(".message p").first()).toHaveCSS(
      "font-size",
      "14px",
    );
    await expect(page.getByLabel("메시지 입력")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath(`conversation-${mode}.png`),
    });
    await page.emulateMedia({
      colorScheme: mode === "light" ? "dark" : "light",
    });
    await expect(page.locator(".conversation")).toHaveCSS(
      "background-color",
      mode === "light" ? "rgb(26, 26, 26)" : "rgb(255, 255, 255)",
    );
    await expect(page.getByRole("log")).toContainText("안녕하세요, 팀 여러분!");
  });
}
