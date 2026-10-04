import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../../tests/helpers/animations";
import {
  installMockBridge,
  openCreateChannelDialog,
} from "../../tests/helpers/bridge";

test("Korean UI switches to English, persists on reload, and preserves a draft", async ({
  page,
}) => {
  // Seed before installing the bridge, which otherwise selects English for
  // the existing smoke suite. Do not overwrite a user's later choice on reload.
  await page.addInitScript(() => {
    if (localStorage.getItem("buzz-ui-language.v1") === null) {
      localStorage.setItem("buzz-ui-language.v1", "ko");
    }
  });
  await installMockBridge(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.getByTestId("open-search")).toContainText("전체 검색");
  await page.getByTestId("channel-general").click();
  await page.getByTestId("message-input").fill("한글 초안 — 그대로 유지");
  await expect(page.getByTestId("send-message")).toHaveAccessibleName(
    "메시지 보내기",
  );

  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
  await expect(page.getByTestId("language-setting-row")).toContainText("언어");
  await waitForAnimations(page);
  await page
    .getByTestId("settings-content-surface")
    .screenshot({ path: "test-results/korean-locale/01-korean-settings.png" });

  // Keyboard is a first-class path through the language control.
  await page.getByTestId("language-option-en").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("settings-nav-appearance")).toContainText(
    "Appearance",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("language-option-en")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("settings-back-to-app").click();
  await expect(page.getByTestId("open-search")).toContainText(
    "Search everything",
  );
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("message-input")).toContainText(
    "한글 초안 — 그대로 유지",
  );
  await page.getByTestId("send-message").click();
  await expect(page.getByTestId("message-timeline")).toContainText(
    "한글 초안 — 그대로 유지",
  );

  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
  await page.getByTestId("language-option-ko").click();
  await page.getByTestId("settings-back-to-app").click();
  await expect(page.getByTestId("open-search")).toContainText("전체 검색");
  await page.getByTestId("channel-general").click();
  await waitForAnimations(page);
  await page
    .getByTestId("app-sidebar")
    .screenshot({ path: "test-results/korean-locale/02-korean-sidebar.png" });
  await openCreateChannelDialog(page);
  await expect(page.getByTestId("create-channel-dialog")).toContainText(
    "새 채널 만들기",
  );
  await expect(page.getByTestId("create-channel-submit")).toHaveText(
    "채널 만들기",
  );
  await expect(
    page.getByTestId("create-channel-permissions-option-private"),
  ).toHaveText("비공개");
  await waitForAnimations(page);
  await page.getByTestId("create-channel-dialog").screenshot({
    path: "test-results/korean-locale/03-korean-create-channel.png",
  });
});
