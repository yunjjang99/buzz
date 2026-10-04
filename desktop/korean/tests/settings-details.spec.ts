import { writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { installMockBridge } from "../../tests/helpers/bridge";
import { waitForAnimations } from "../../tests/helpers/animations";

test("settings details and recovery dialogs translate without changing user content", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem("buzz-ui-language.v1", "ko"),
  );
  await installMockBridge(page, {
    relayRequiresMembership: true,
    relayRole: "owner",
  });
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  const surface = page.getByTestId("settings-content-surface");
  const sections = [
    ["profile", "프로필"],
    ["notifications", "알림"],
    ["voice", "음성"],
    ["shortcuts", "키보드 단축키"],
    ["custom-emoji", "사용자 이모지"],
    ["local-archive", "로컬 보관함"],
    ["channel-templates", "채널 템플릿"],
    ["hosted-communities", "호스팅 워크스페이스"],
    ["community-members", "직원 초대"],
    ["relay-admin", "관리자"],
    ["agents", "AI 에이전트"],
    ["compute", "컴퓨팅 자원 공유"],
    ["experimental", "실험 기능"],
    ["mobile", "모바일"],
    ["updates", "앱 업데이트"],
  ];
  const renderedCopy: Record<string, string> = {};
  for (const [id, title] of sections) {
    await page.getByTestId(`settings-nav-${id}`).click();
    await expect(
      surface.getByRole("heading", { name: title, exact: true }).first(),
    ).toBeVisible();
    if (id === "local-archive")
      await expect(surface).toContainText("서버에 저장되지 않는 임시 이벤트");
    if (id === "agents") await expect(surface).toContainText("제공업체 선택…");
    if (id === "compute") await expect(surface).toContainText("적합");
    renderedCopy[id] = await surface.innerText();
    await expect(surface).not.toContainText(
      "Manage members and community access.",
    );
    await expect(surface).not.toContainText(
      "All available keyboard shortcuts.",
    );
  }
  await writeFile(
    testInfo.outputPath("settings-copy.json"),
    JSON.stringify(renderedCopy, null, 2),
  );
  await testInfo.attach("settings-copy", {
    body: JSON.stringify(renderedCopy, null, 2),
    contentType: "application/json",
  });
  await page.getByTestId("settings-nav-notifications").click();
  await expect(surface).toContainText("대화를 보고 있을 때도 알림");
  await expect(surface).toContainText("채널에서 누군가 나를 멘션했을 때");
  await waitForAnimations(page);
  await surface.screenshot({
    path: "test-results/korean-locale/05-settings-notifications.png",
  });
  await page.getByTestId("settings-nav-local-archive").click();
  await page.getByTestId("local-archive-open-add").click();
  await expect(surface).toContainText("메시지와 게시물");
  await expect(surface).toContainText("채팅 메시지 v2 (유형 40002)");
  // Labels translate while kind identifiers and form values stay unchanged.
  await expect(page.getByTestId("local-archive-kind-40002")).toBeVisible();
  await surface.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByTestId("settings-nav-shortcuts").click();
  await expect(surface).toContainText("현재 채널의 메시지 검색");
  await page.getByTestId("settings-nav-profile").click();
  await expect(surface).toContainText(
    "이 기기의 계정 키와 앱 데이터를 모두 삭제합니다.",
  );
  await page
    .getByRole("button", { name: "내 기기 데이터 삭제", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "로그아웃하고 기기 데이터를 모두 삭제할까요?",
  );
  await expect(
    page.getByRole("button", { name: "개인 키 보기", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("alertdialog").getByRole("textbox"),
  ).toHaveAttribute("placeholder", "wipe all my data");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "취소", exact: true })
    .click();
  await page.getByTestId("settings-nav-appearance").click();
  await page.getByTestId("language-option-en").click();
  await page.getByTestId("settings-nav-notifications").click();
  await expect(surface).toContainText("Notify while viewing");
  await expect(surface).toContainText("When someone tags you in a channel.");
  await page.getByTestId("settings-nav-profile").click();
  await expect(surface).toContainText("Sign out");
});
