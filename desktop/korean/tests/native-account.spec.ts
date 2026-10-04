import { test, expect } from "@playwright/test";
import { installMockBridge } from "../../tests/helpers/bridge";
import { waitForAnimations } from "../../tests/helpers/animations";
const pubkey = "deadbeef".repeat(8);
const account = {
  username: "admin",
  name: "관리자",
  pubkey,
  role: "admin",
  mustChangePassword: false,
  status: "ready",
  provisioningError: "",
};

test("native first run ID login enters the full client and survives reload", async ({
  page,
}) => {
  await installMockBridge(
    page,
    { backupVerificationPubkeys: [pubkey] },
    { skipOnboardingSeed: true, skipCommunitySeed: true },
  );
  await page.route("https://buzz.kovar.kr/chat-api/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        },
      });
    const input = route.request().postDataJSON();
    return route.fulfill({
      status: input.password === "fixture password" ? 200 : 401,
      headers: { "Access-Control-Allow-Origin": "*" },
      json:
        input.password === "fixture password"
          ? { account, backup: "ncryptsec1fixture", token: "a".repeat(64) }
          : { error: "invalid-login" },
    });
  });
  await page.goto("/");
  const form = page.getByRole("form", { name: "앱 아이디 로그인" });
  await form.getByLabel("아이디", { exact: true }).fill("admin");
  await form.getByLabel("비밀번호", { exact: true }).fill("incorrect");
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("올바르지");
  await form.getByLabel("비밀번호", { exact: true }).fill("fixture password");
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByTestId("open-search")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("open-search")).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain("fixture password");
  expect(storage).not.toContain("ncryptsec1fixture");
});

test("native settings signs in as the same owner and opens employee management", async ({
  page,
}) => {
  await installMockBridge(page, { backupVerificationPubkeys: [pubkey] });
  await page.route("https://buzz.kovar.kr/chat-api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const value = path.endsWith("desktop/login")
      ? { account, backup: "ncryptsec1fixture", token: "a".repeat(64) }
      : path.endsWith("accounts")
        ? [account]
        : [];
    await route.fulfill({
      json: value,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
    });
  });
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByRole("button", { name: "직원 계정 · 아이디 로그인" }).click();
  const form = page.getByRole("form", { name: "앱 아이디 로그인" });
  await form.getByLabel("아이디", { exact: true }).fill("admin");
  await form.getByLabel("비밀번호", { exact: true }).fill("fixture password");
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "직원 계정 발급" }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page
    .locator(".account-overlay")
    .screenshot({ path: "test-results/korean-locale/04-native-accounts.png" });
});
