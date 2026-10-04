import { expect, test, type Page } from "@playwright/test";
import {
  finalizeEvent,
  getPublicKey,
  type EventTemplate,
} from "nostr-tools/pure";
import { waitForAnimations } from "../../../tests/helpers/animations";
const key = new Uint8Array(32).fill(1);
const owner = getPublicKey(key);
const relayKey = new Uint8Array(32).fill(2);
const signed = (
  kind: number,
  tags: string[][],
  content = "",
  secret = relayKey,
) => finalizeEvent({ kind, tags, content, created_at: 100 }, secret);
const history = signed(9, [["h", "general"]], "지난주에 나눈 기존 대화", key);
type Account = {
  username: string;
  name: string;
  pubkey: string;
  role: string;
  mustChangePassword: boolean;
  status: string;
  provisioningError: string;
};
async function fixture(page: Page, role: "admin" | "member" = "admin") {
  let session: Account | null = null;
  let password = "fixture initial password";
  const account: Account = {
    username: role === "admin" ? "admin" : "staff01",
    name: "테스트 직원",
    pubkey: owner,
    role,
    mustChangePassword: role === "member",
    status: "ready",
    provisioningError: "",
  };
  const accounts = [account];
  await page.route("**/chat-api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const data = request.method() === "POST" ? request.postDataJSON() : {};
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        contentType: "application/json",
        status,
        body: JSON.stringify(body),
      });
    if (path.endsWith("/status")) return reply({ configured: true });
    if (path.endsWith("/login")) {
      if (data.username !== account.username || data.password !== password)
        return reply({ error: "invalid-login" }, 401);
      session = account;
      return reply(account);
    }
    if (!session) return reply({ error: "login-required" }, 401);
    if (path.endsWith("/session")) return reply(session);
    if (path.endsWith("/logout")) {
      session = null;
      return reply({ ok: true });
    }
    if (path.endsWith("/sign"))
      return reply(finalizeEvent(data.template as EventTemplate, key));
    if (path.endsWith("/password")) {
      if (data.currentPassword !== password)
        return reply({ error: "invalid-login" }, 401);
      password = data.password;
      account.mustChangePassword = false;
      return reply(account);
    }
    if (path.endsWith("/admin/channels"))
      return reply([{ id: "general", name: "일반" }]);
    if (path.endsWith("/admin/accounts")) return reply(accounts);
    if (path.endsWith("/admin/create")) {
      expect(data.channels).toEqual(["general"]);
      accounts.push({
        ...account,
        username: data.username,
        name: data.name,
        role: "member",
        status: "ready",
      });
      return reply(accounts.at(-1), 201);
    }
    return reply({ error: "not-found" }, 404);
  });
  await page.routeWebSocket("wss://buzz.kovar.kr", (socket) => {
    const subscriptions = new Map<string, number[]>();
    socket.send(JSON.stringify(["AUTH", "login-fixture-challenge"]));
    socket.onMessage((value) => {
      const [kind, id, filter] = JSON.parse(String(value));
      if (kind === "AUTH") socket.send(JSON.stringify(["OK", id.id, true, ""]));
      if (kind === "REQ") {
        subscriptions.set(id, filter.kinds);
        const send = (event: unknown) =>
          socket.send(JSON.stringify(["EVENT", id, event]));
        if (filter.kinds[0] === 39002)
          send(
            signed(39002, [
              ["d", "general"],
              ["p", owner],
            ]),
          );
        if (filter.kinds[0] === 39000)
          send(
            signed(39000, [
              ["d", "general"],
              ["name", "일반"],
              ["t", "stream"],
            ]),
          );
        if (filter.kinds[0] === 0)
          send(signed(0, [], JSON.stringify({ name: "테스트 직원" }), key));
        if (filter.kinds.includes(9)) send(history);
        socket.send(JSON.stringify(["EOSE", id]));
      }
      if (kind === "EVENT") {
        socket.send(JSON.stringify(["OK", id.id, true, ""]));
        for (const [subscription, kinds] of subscriptions)
          if (kinds.includes(9))
            socket.send(JSON.stringify(["EVENT", subscription, id]));
      }
    });
  });
}
async function signIn(page: Page, username: string, password: string) {
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}
async function openAccounts(page: Page) {
  const list = page.getByRole("button", { name: "채널 목록", exact: true });
  if (await list.isVisible()) await list.click();
  await page.getByRole("button", { name: "계정 관리", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("employee ID login restores conversations and session; owner issues accounts", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/chat/");
  await signIn(page, "admin", "wrong password");
  await expect(page.getByRole("alert")).toContainText("아이디 또는 비밀번호");
  await signIn(page, "admin", "fixture initial password");
  await expect(page.getByRole("log")).toContainText("지난주에 나눈 기존 대화");
  await page.reload();
  await expect(page.getByRole("log")).toContainText("지난주에 나눈 기존 대화");
  await openAccounts(page);
  await page.getByLabel("직원 아이디", { exact: true }).fill("staff02");
  await page.getByLabel("직원 이름", { exact: true }).fill("새 직원");
  await page
    .getByLabel("초기 비밀번호", { exact: true })
    .fill("new fixture password");
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: "일반", exact: true })
    .check();
  await page
    .getByRole("button", { name: "직원 계정 만들기", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("staff02 · 사용 가능");
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/korean-web/07-admin-accounts.png",
  });
  await page.getByRole("button", { name: "계정 관리 닫기" }).click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByLabel("아이디", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("암호화 계정 백업", { exact: true }),
  ).not.toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/korean-web/06-employee-login.png",
  });
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain("fixture password");
});

test("employee changes temporary password without changing identity or history", async ({
  page,
}) => {
  await fixture(page, "member");
  await page.goto("/chat/");
  await signIn(page, "staff01", "fixture initial password");
  await expect(page.getByRole("dialog")).toContainText("초기 비밀번호 변경");
  await page
    .getByLabel("현재 비밀번호", { exact: true })
    .fill("fixture initial password");
  await page
    .getByLabel("새 비밀번호", { exact: true })
    .fill("fixture permanent password");
  await page
    .getByLabel("새 비밀번호 확인", { exact: true })
    .fill("fixture permanent password");
  await page
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "비밀번호를 변경했습니다" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "직원 계정 만들기" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "계정 관리 닫기" }).click();
  await expect(page.getByRole("log")).toContainText("지난주에 나눈 기존 대화");
  await page.getByLabel("메시지 입력").fill("같은 계정으로 계속 대화합니다");
  await page.getByRole("button", { name: "메시지 보내기" }).click();
  await expect(page.getByRole("log")).toContainText(
    "같은 계정으로 계속 대화합니다",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("choosing legacy sign-in fences a delayed automatic session restore", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/chat/");
  await signIn(page, "admin", "fixture initial password");
  await expect(page.getByRole("log")).toContainText("지난주에 나눈 기존 대화");
  await page.route("**/chat-api/session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fallback();
  });
  await page.reload();
  await page.locator("summary").click();
  await expect(
    page.getByRole("status").filter({ hasText: "로그인 상태 확인 중" }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("암호화 계정 백업", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("log")).toHaveCount(0);
});

test("locked login explains server retry time and clears the password", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/chat-api/login", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "Retry-After": "300" },
      body: JSON.stringify({ error: "login-locked", retryAfter: 300 }),
    }),
  );
  await page.goto("./");
  await page
    .getByRole("textbox", { name: "아이디", exact: true })
    .fill("admin");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("fixture wrong password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("약 5분 후 다시 시도");
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveValue("");
});
