import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPublicKey } from "nostr-tools/pure";
import { createLoginService } from "../login-service/server.mjs";
import { passwordHash } from "../login-service/store.mjs";
import { hotp } from "../login-service/mfa.mjs";
import { installRelay, key } from "./fixtures";
import { waitForAnimations } from "../../../tests/helpers/animations";

function decode(encoded: string) {
  const bits = [...encoded]
    .map((letter) =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        .indexOf(letter)
        .toString(2)
        .padStart(5, "0"),
    )
    .join("");
  return Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)),
  );
}

test("real MFA service: enroll, acknowledge recovery, challenge next login and rotate lost authenticator", async ({
  page,
  request,
}, testInfo) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "buzz-mfa-browser-"));
  const owner = getPublicKey(key);
  const password = "synthetic browser password";
  const service = await createLoginService({
    directory,
    owner,
    origin: "https://buzz.kovar.kr",
    disableJobs: true,
    bridge: { query: async () => [], publish: async () => {} },
  });
  const hash = await passwordHash(password);
  service.store.transaction((state: { accounts: Record<string, unknown> }) => {
    state.accounts.admin = {
      username: "admin",
      name: "관리자",
      pubkey: owner,
      role: "admin",
      enabled: true,
      hash,
      key: service.store.seal(key, owner),
      mustChangePassword: false,
    };
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  let cookie = "";
  try {
    await installRelay(page);
    // The UI drives the real server. Only the relay and HTTPS cookie transport are fixture adapters.
    await page.route("**/chat-api/**", async (route) => {
      const source = route.request();
      const response = await request.fetch(
        `http://127.0.0.1:${service.server.address().port}${new URL(source.url()).pathname}`,
        {
          method: source.method(),
          data: source.postData() ?? undefined,
          headers: {
            Origin: "https://buzz.kovar.kr",
            "Content-Type": "application/json",
            Cookie: cookie,
          },
        },
      );
      const next = response.headers()["set-cookie"];
      if (next) cookie = next.split(";")[0];
      await route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: await response.text(),
      });
    });
    await page.goto("/chat/");
    await page.getByLabel("아이디", { exact: true }).fill("admin");
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "관리자 2단계 인증 등록" }),
    ).toBeVisible();
    expect(Object.keys(service.store.state.sessions)).toHaveLength(0);
    const secret = await page
      .getByLabel("설정 키", { exact: true })
      .inputValue();
    const codes = await page
      .getByRole("list", { name: "일회용 복구 코드" })
      .locator("code")
      .allTextContents();
    expect(codes).toHaveLength(10);
    await expect(
      page.getByRole("button", { name: "등록 완료" }),
    ).toBeDisabled();
    await page.getByLabel("복구 코드를 안전한 곳에 저장했습니다").check();
    await page
      .getByLabel("인증 앱의 6자리 코드")
      .fill(hotp(decode(secret), Math.floor(Date.now() / 30000)));
    await waitForAnimations(page);
    await page
      .getByRole("form", { name: "관리자 2단계 인증 등록" })
      .screenshot({ path: testInfo.outputPath("mfa-enrollment.png") });
    await page.getByRole("button", { name: "등록 완료" }).click();
    await expect(page.getByRole("log")).toContainText("안녕하세요, 팀 여러분!");
    cookie = ""; // Simulate a fresh browser session without issuing a logout shortcut.
    await page.reload();
    await page.getByLabel("아이디", { exact: true }).fill("admin");
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    const code = page.getByLabel("인증 코드 또는 복구 코드", { exact: true });
    await expect(code).toBeVisible();
    await code.fill("invalid");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("이미 사용");
    await code.fill(codes[0]);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page.getByRole("log")).toBeVisible();
    const channels = page.getByRole("button", {
      name: "채널 목록",
      exact: true,
    });
    if (await channels.isVisible()) await channels.click();
    await page.getByRole("button", { name: "계정 관리", exact: true }).click();
    await expect(
      page.getByText("남은 복구 코드: 9개.", { exact: false }),
    ).toBeVisible();
    await page
      .getByLabel("현재 비밀번호 (MFA 변경)", { exact: true })
      .fill(password);
    // A recovery-authenticated session can replace its factor even when the last recovery code was used.
    await expect(
      page.getByLabel("현재 인증 코드 또는 복구 코드", { exact: true }),
    ).toHaveValue("");
    await page.getByRole("button", { name: "인증 앱·복구 코드 교체" }).click();
    const nextSecret = await page
      .getByLabel("설정 키", { exact: true })
      .inputValue();
    expect(nextSecret).not.toBe(secret);
    await page.getByLabel("복구 코드를 안전한 곳에 저장했습니다").check();
    await page
      .getByLabel("인증 앱의 6자리 코드")
      .fill(hotp(decode(nextSecret), Math.floor(Date.now() / 30000)));
    await page.getByRole("button", { name: "등록 완료" }).click();
    await expect(
      page.getByRole("region", { name: "관리자 MFA 관리" }).getByRole("status"),
    ).toContainText("새 인증 앱 등록을 완료");
    const storage = await page.evaluate(() =>
      JSON.stringify([localStorage, sessionStorage]),
    );
    for (const value of [password, secret, nextSecret, ...codes])
      expect(storage).not.toContain(value);
  } finally {
    await service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
