import { expect, test } from "@playwright/test";
import { finalizeEvent, getPublicKey, type Event } from "nostr-tools/pure";
import { matchFilter } from "nostr-tools/filter";
import { waitForAnimations } from "../../../tests/helpers/animations";
const key = new Uint8Array(32).fill(1);
const account = {
  username: "staff",
  name: "테스트 직원",
  pubkey: getPublicKey(key),
  role: "member",
  mustChangePassword: false,
  status: "ready",
  provisioningError: "",
};
test("authenticated strategy task saves, appears by time, completes and survives reload", async ({
  page,
}) => {
  const events: Event[] = [];
  let rejectNext = false;
  await page.route("**/chat-api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = path.endsWith("/status")
      ? { configured: true }
      : account;
    if (path.endsWith("/sign"))
      body = finalizeEvent(route.request().postDataJSON().template, key);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.routeWebSocket("wss://buzz.kovar.kr", (socket) => {
    socket.send(JSON.stringify(["AUTH", "strategy-test"]));
    socket.onMessage((raw) => {
      const [op, id, filter] = JSON.parse(String(raw));
      if (op === "AUTH") socket.send(JSON.stringify(["OK", id.id, true, ""]));
      if (op === "REQ") {
        for (const event of events.filter((e) => matchFilter(filter, e)))
          socket.send(JSON.stringify(["EVENT", id, event]));
        socket.send(JSON.stringify(["EOSE", id]));
      }
      if (op === "EVENT") {
        if (rejectNext) {
          rejectNext = false;
          socket.send(JSON.stringify(["OK", id.id, false, "test-failure"]));
        } else {
          events.push(id);
          socket.send(JSON.stringify(["OK", id.id, true, ""]));
        }
      }
    });
  });
  await page.goto("/chat/strategy.html");
  await expect(
    page.getByRole("heading", { name: "코바 전략실" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 업무 등록" })).toBeEnabled();
  await page.getByRole("button", { name: "+ 업무 등록" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("할 일", { exact: true })
    .fill("테스트 통관 서류 제출");
  await dialog
    .getByLabel("시간 (한국 시간 · 선택)", { exact: true })
    .fill("15:00");
  await dialog.getByLabel("업무 유형").selectOption("통관");
  await dialog.getByLabel("물품 · 수량").fill("6205 베어링 · 200개");
  await dialog.getByRole("button", { name: "업무 저장" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".agenda-item")).toContainText("15:00");
  await page.reload();
  await expect(page.locator(".agenda-item")).toContainText("6205 베어링");
  await page.locator(".agenda-item").click();
  await dialog.getByLabel("진행 상태").selectOption("완료");
  rejectNext = true;
  await dialog.getByRole("button", { name: "업무 저장" }).click();
  await expect(page.getByRole("button", { name: "저장 재시도" })).toBeVisible();
  await dialog
    .getByRole("button", { name: "닫기", exact: true })
    .last()
    .click();
  await page.reload();
  await page.getByRole("button", { name: "저장 재시도" }).click();
  await expect(page.locator(".agenda-item")).toContainText("완료");
  await expect(
    page.getByRole("button", { name: "저장 재시도" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "이전 달" }).click();
  await expect(page.locator(".agenda-item")).toHaveCount(0);
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(page.locator(".agenda-item")).toContainText("완료");
  await waitForAnimations(page);
  await page.screenshot({
    path: `test-results/strategy-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("unauthenticated strategy shows sign-in and does not expose mail or metrics", async ({
  page,
}) => {
  await page.route("**/chat-api/**", (route) =>
    route.fulfill({
      status: route.request().url().endsWith("/status") ? 200 : 401,
      contentType: "application/json",
      body: JSON.stringify(
        route.request().url().endsWith("/status")
          ? { configured: true }
          : { error: "login-required" },
      ),
    }),
  );
  await page.goto("/chat/strategy.html");
  await expect(page.getByLabel("아이디", { exact: true })).toBeVisible();
  await expect(page.getByLabel("업무 요약")).toHaveCount(0);
});
