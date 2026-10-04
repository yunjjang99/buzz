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
    if (route.request().method() === "GET") {
      expect(route.request().headers().authorization).toBe(
        `Bearer ${"a".repeat(64)}`,
      );
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        json: path.endsWith("session")
          ? account
          : path.endsWith("accounts")
            ? [account]
            : [],
      });
    }
    const input = route.request().postDataJSON();
    if (input.password === "fixture password" && input.mfaCode !== "123456")
      return route.fulfill({
        status: 403,
        headers: { "Access-Control-Allow-Origin": "*" },
        json: { error: "mfa-required" },
      });
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
  await expect(form.getByLabel("인증 코드 또는 복구 코드")).toBeVisible();
  await expect(page.getByTestId("open-search")).not.toBeVisible();
  await form.getByLabel("인증 코드 또는 복구 코드").fill("123456");
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByTestId("open-search")).toBeVisible();
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByRole("button", { name: "직원 계정 · 아이디 로그인" }).click();
  await expect(
    page.getByRole("heading", { name: "직원 계정 발급" }),
  ).toBeVisible();
  await page
    .getByLabel("직원 아이디", { exact: true })
    .fill("shin4895@gmail.com");
  await expect(page.getByLabel("직원 아이디", { exact: true })).toHaveValue(
    "shin4895@gmail.com",
  );
  await expect(form).not.toBeVisible();
  await page.getByRole("button", { name: "계정 관리 닫기" }).click();
  await page.getByRole("button", { name: "메신저로 돌아가기" }).click();
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

test("isolated first login imports the employee identity rather than the generated startup key", async ({
  page,
}) => {
  const employeePubkey =
    "e5ebc6cdb579be112e336cc319b5989b4bb6af11786ea90dbe52b5f08d741b34";
  const encrypted =
    "ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p";
  await installMockBridge(
    page,
    { backupVerificationPubkeys: [employeePubkey] },
    { skipOnboardingSeed: true, skipCommunitySeed: true },
  );
  await page.route("https://buzz.kovar.kr/chat-api/**", (route) =>
    route.fulfill({
      json: {
        account: {
          ...account,
          pubkey: employeePubkey,
          username: "employee",
          role: "member",
        },
        backup: encrypted,
        token: "b".repeat(64),
      },
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
    }),
  );
  await page.goto("/");
  const form = page.getByRole("form", { name: "앱 아이디 로그인" });
  await form.getByLabel("아이디", { exact: true }).fill("employee");
  await form
    .getByLabel("비밀번호", { exact: true })
    .fill("mock horse battery staple lake orbit");
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByTestId("open-search")).toBeVisible();
  expect(
    await page.evaluate(
      (key) =>
        localStorage.getItem(`buzz-machine-onboarding-complete.v2:${key}`),
      employeePubkey,
    ),
  ).toBe("true");
});
