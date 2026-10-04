import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../../tests/helpers/bridge";
import { waitForAnimations } from "../../tests/helpers/animations";
import type { WebAccount } from "../web/login-api";

const pubkey = "deadbeef".repeat(8);
const admin: WebAccount = {
  username: "admin",
  name: "테스트 관리자",
  pubkey,
  role: "admin",
  mustChangePassword: false,
  status: "ready",
  provisioningError: "",
};
const token = "a".repeat(64);

async function fixture(page: Page) {
  const records = [admin];
  const state = {
    session: "valid" as "valid" | "expired" | "different-identity",
    adminReads: 0,
    created: null as Record<string, unknown> | null,
  };
  await page.route("https://buzz.kovar.kr/chat-api/**", async (route) => {
    const request = route.request();
    const routeName = new URL(request.url()).pathname.replace("/chat-api/", "");
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    };
    const reply = (json: unknown, status = 200) =>
      route.fulfill({ json, status, headers });
    if (request.method() === "OPTIONS") return reply({});
    if (routeName === "desktop/login") {
      expect(request.postDataJSON()).toEqual({
        username: "admin",
        password: "fixture password",
      });
      state.session = "valid";
      return reply({ account: admin, backup: "ncryptsec1fixture", token });
    }
    expect(request.headers().authorization).toBe(`Bearer ${token}`);
    if (routeName === "session") {
      if (state.session === "expired")
        return reply({ error: "login-required" }, 401);
      return reply(
        state.session === "different-identity"
          ? { ...admin, pubkey: "a".repeat(64) }
          : admin,
      );
    }
    if (routeName === "admin/accounts") {
      state.adminReads++;
      return reply(records);
    }
    if (routeName === "admin/channels") {
      state.adminReads++;
      return reply([{ id: "general", name: "일반" }]);
    }
    if (routeName === "admin/create") {
      const data = request.postDataJSON();
      state.created = data;
      const employee: WebAccount = {
        ...admin,
        username: data.username,
        name: data.name,
        role: "member",
      };
      records.push(employee);
      return reply(employee, 201);
    }
    throw new Error(`Unexpected employee-page request: ${routeName}`);
  });
  return state;
}

async function openSettings(page: Page) {
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
}

async function signIn(page: Page) {
  const form = page.getByRole("form", { name: "앱 아이디 로그인" });
  await form.getByLabel("아이디", { exact: true }).fill("admin");
  await form.getByLabel("비밀번호", { exact: true }).fill("fixture password");
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(form).not.toBeVisible();
}

test("admin creates employees on the native settings page and reauthenticates there after restart", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      relayRequiresMembership: true,
      relayRole: "owner",
      backupVerificationPubkeys: [pubkey],
    },
    {
      relayWsUrl: "wss://buzz.kovar.kr",
      skipOnboardingSeed: true,
      skipCommunitySeed: true,
    },
  );
  const state = await fixture(page);
  await page.goto("/");
  await signIn(page);
  await openSettings(page);
  const nav = page.getByTestId("settings-nav-employee-accounts");
  await expect(nav).toHaveAccessibleName("직원 계정 관리");
  await nav.click();
  const surface = page.getByTestId("settings-employee-accounts");
  await expect(
    surface.getByRole("heading", { name: "직원 계정 발급" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await surface
    .getByLabel("직원 아이디", { exact: true })
    .fill("employee.fixture@example.test");
  await surface.getByLabel("직원 이름", { exact: true }).fill("테스트 직원");
  await surface
    .getByLabel("초기 비밀번호", { exact: true })
    .fill("fixture initial password");
  await surface.getByRole("checkbox", { name: "일반", exact: true }).check();
  await surface
    .getByRole("button", { name: "직원 계정 만들기", exact: true })
    .click();
  await expect(surface.getByRole("status")).toContainText(
    "계정 발급을 요청했습니다",
  );
  expect(state.created).toEqual({
    username: "employee.fixture@example.test",
    name: "테스트 직원",
    password: "fixture initial password",
    channels: ["general"],
  });
  await expect(
    surface.getByText("employee.fixture@example.test · 사용 가능", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    surface.getByLabel("초기 비밀번호", { exact: true }),
  ).toHaveValue("");
  await surface
    .getByRole("heading", { name: "직원 계정 관리", exact: true })
    .scrollIntoViewIfNeeded();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/korean-locale/07-native-employee-page.png",
  });
  await page.getByTestId("settings-nav-profile").click();
  await nav.click();
  await expect(
    surface.getByRole("heading", { name: "직원 계정 발급" }),
  ).toBeVisible();

  await page.reload();
  await expect(
    surface.getByRole("heading", { name: "직원 계정 관리 인증" }),
  ).toBeVisible();
  await expect(nav).toHaveAttribute("aria-pressed", "true");
  const reads = state.adminReads;
  await expect(
    surface.getByRole("button", { name: "직원 계정 만들기", exact: true }),
  ).not.toBeVisible();
  expect(state.adminReads).toBe(reads);
  await signIn(page);
  await expect(
    surface.getByRole("heading", { name: "직원 계정 발급" }),
  ).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain("fixture password");
  expect(storage).not.toContain("fixture initial password");
  expect(storage).not.toContain(token);
});

for (const problem of ["expired", "different-identity"] as const) {
  test(`employee page recovers from a ${problem} session before reading employee data`, async ({
    page,
  }) => {
    await installMockBridge(
      page,
      {
        relayRequiresMembership: true,
        relayRole: "owner",
        backupVerificationPubkeys: [pubkey],
      },
      { relayWsUrl: "wss://buzz.kovar.kr" },
    );
    const state = await fixture(page);
    await page.goto("/");
    await openSettings(page);
    await page.getByTestId("settings-nav-employee-accounts").click();
    await signIn(page);
    const surface = page.getByTestId("settings-employee-accounts");
    await expect(
      surface.getByRole("heading", { name: "직원 계정 발급" }),
    ).toBeVisible();
    await expect(
      surface.getByRole("checkbox", { name: "일반", exact: true }),
    ).toBeVisible();
    await page.getByTestId("settings-nav-profile").click();
    state.session = problem;
    const reads = state.adminReads;
    await page.getByTestId("settings-nav-employee-accounts").click();
    await expect(surface.getByRole("alert")).toContainText(
      problem === "expired" ? "만료" : "같은 아이디",
    );
    await expect(
      surface.getByRole("button", { name: "직원 계정 만들기", exact: true }),
    ).not.toBeVisible();
    expect(state.adminReads).toBe(reads);
    await signIn(page);
    await expect(
      surface.getByRole("heading", { name: "직원 계정 발급" }),
    ).toBeVisible();
  });
}

for (const scenario of [
  {
    name: "ordinary member",
    relayRole: "member" as const,
    relayWsUrl: "wss://buzz.kovar.kr",
  },
  {
    name: "owner of another relay",
    relayRole: "owner" as const,
    relayWsUrl: "wss://other.example.test",
  },
]) {
  test(`${scenario.name} has no employee issuance page`, async ({ page }) => {
    await installMockBridge(
      page,
      { relayRequiresMembership: true, relayRole: scenario.relayRole },
      { relayWsUrl: scenario.relayWsUrl },
    );
    const state = await fixture(page);
    await page.goto("/#/settings?section=employee-accounts");
    await expect(page.getByTestId("settings-nav-appearance")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByTestId("settings-nav-employee-accounts"),
    ).not.toBeVisible();
    await expect(
      page.getByTestId("settings-employee-accounts"),
    ).not.toBeVisible();
    expect(state.adminReads).toBe(0);
  });
}
