import { expect, test } from "@playwright/test";
import { encrypt } from "nostr-tools/nip49";
import { key, root, installRelay, signInWithExtension } from "./fixtures";
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
async function openLegacy(page: import("@playwright/test").Page) {
  await page.locator("summary").click();
}

test("browser login, Korean messaging, replies, language persistence, and mobile layout", async ({
  page,
}) => {
  const published = await installRelay(page);
  await signInWithExtension(page);
  await page.getByLabel("메시지 입력").fill("한글 조합 중");
  await page.getByLabel("메시지 입력").dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  expect(published).toHaveLength(0);
  await page.getByLabel("메시지 입력").fill("웹에서 보낸 한글 메시지");
  await page.getByLabel("메시지 입력").press("Enter");
  await expect(page.getByRole("log")).toContainText("웹에서 보낸 한글 메시지");
  await page
    .locator(`[data-message-id="${root.id}"]`)
    .getByRole("button", { name: "답장", exact: true })
    .click();
  await page.getByLabel("메시지 입력").fill("웹 답글");
  await page.getByRole("button", { name: "메시지 보내기" }).click();
  await expect(
    page.getByRole("region", { name: "답글 대화", exact: true }),
  ).toContainText("웹 답글");
  expect(published[1].tags).toContainEqual(["e", root.id, "", "reply"]);
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/korean-web/02-conversation.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "답글 대화 닫기" }).click();
  await expect(
    page.getByRole("button", { name: "채널 목록", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "채널 목록", exact: true }).click();
  await expect(page.getByRole("complementary")).toBeVisible();
  await page.getByRole("button", { name: "일반", exact: true }).click();
  await page.getByLabel("메시지 입력").fill("모바일에서도 안녕하세요");
  await page.getByRole("button", { name: "메시지 보내기" }).click();
  await expect(page.getByRole("log")).toContainText("모바일에서도 안녕하세요");
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/korean-web/04-mobile-conversation.png",
  });
  await page.setViewportSize({ width: 360, height: 480 });
  await page.getByLabel("메시지 입력").focus();
  const sendBounds = await page
    .getByRole("button", { name: "메시지 보내기" })
    .boundingBox();
  if (!sendBounds) throw new Error("Send button is not visible");
  expect(sendBounds.y + sendBounds.height).toBeLessThanOrEqual(480);
  expect(sendBounds.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByLabel("언어", { exact: true }).selectOption("en");
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome to Buzz" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByLabel("Language", { exact: true }).selectOption("ko");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/korean-web/03-mobile-login.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("local encrypted backup decrypts in the real worker and never crosses the socket", async ({
  page,
}) => {
  const published = await installRelay(page, true);
  await page.goto("/chat/");
  await openLegacy(page);
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/korean-web/01-login.png" });
  const password = "temporary fixture password";
  const encrypted = encrypt(key, password, 18);
  await page.getByLabel("암호화 계정 백업", { exact: true }).setInputFiles({
    name: "test.ncryptsec",
    mimeType: "text/plain",
    buffer: Buffer.from(encrypted),
  });
  await page.getByLabel("백업 비밀번호").fill("incorrect password");
  await page
    .getByLabel("이 기기에 암호화된 계정 저장", { exact: true })
    .check();
  await page.getByRole("button", { name: "백업으로 로그인" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "백업 비밀번호가 다르거나",
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem("buzz-korean-web.account.v1"),
    ),
  ).toBeNull();
  await page.getByLabel("백업 비밀번호").fill(password);
  await page.getByRole("button", { name: "백업으로 로그인" }).click();
  await expect(page.getByRole("log")).toContainText("안녕하세요, 팀 여러분!");
  const accountRecord = await page.evaluate(() =>
    localStorage.getItem("buzz-korean-web.account.v1"),
  );
  expect(accountRecord).toContain(encrypted);
  expect(accountRecord).not.toContain(password);
  expect(accountRecord).not.toContain(Buffer.from(key).toString("hex"));
  await page.reload();
  await openLegacy(page);
  await expect(
    page.getByText("이 기기에 연결된 계정", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("암호화 계정 백업", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("백업 비밀번호").fill(password);
  await page
    .locator(".legacy-login")
    .getByRole("button", { name: "로그인", exact: true })
    .click();
  await expect(page.getByRole("log")).toContainText("안녕하세요, 팀 여러분!");
  await page.getByLabel("메시지 입력").fill("전송 실패 후 재시도");
  await page.getByRole("button", { name: "메시지 보내기" }).click();
  await expect(page.getByRole("alert")).toContainText("test rejection");
  const id = published[0].id;
  const stored = await page.evaluate(() =>
    sessionStorage.getItem("buzz-korean-web.outbox.v1"),
  );
  expect(stored).toContain(id);
  expect(stored).not.toContain(password);
  expect(stored).not.toContain(encrypted);
  await page.getByRole("button", { name: "같은 메시지 다시 전송" }).click();
  await expect(page.getByRole("log")).toContainText("전송 실패 후 재시도");
  expect(published.map((event) => event.id)).toEqual([id, id]);
  expect(JSON.stringify(published)).not.toContain(encrypted);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("buzz-korean-web.outbox.v1"),
    ),
  ).toBeNull();
  const channelList = page.getByRole("button", {
    name: "채널 목록",
    exact: true,
  });
  if (await channelList.isVisible()) await channelList.click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await openLegacy(page);
  await expect(
    page.getByText("이 기기에 연결된 계정", { exact: true }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/korean-web/05-saved-account-login.png",
  });
  await page.getByRole("button", { name: "다른 계정 연결" }).click();
  await expect(
    page.getByLabel("암호화 계정 백업", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "저장된 계정으로 돌아가기" }).click();
  await page.getByRole("button", { name: "기기에 저장된 계정 지우기" }).click();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("buzz-korean-web.account.v1"),
    ),
  ).toBeNull();
});

test("corrupt saved account preserves a recovery path", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("buzz-korean-web.account.v1", "corrupt record");
  });
  await page.goto("/chat/");
  await openLegacy(page);
  await expect(page.getByRole("alert")).toContainText(
    "저장된 계정을 읽을 수 없습니다",
  );
  await page.getByRole("button", { name: "기기에 저장된 계정 지우기" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("buzz-korean-web.account.v1"),
    ),
  ).toBeNull();
  await expect(
    page.getByLabel("암호화 계정 백업", { exact: true }),
  ).toBeVisible();
});
