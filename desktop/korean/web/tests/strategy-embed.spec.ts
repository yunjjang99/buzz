import { test, expect } from "@playwright/test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
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
test("web strategy shares the channel shell and returns to the conversation", async ({
  page,
}) => {
  await page.route("**/chat-api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/sign")
        ? finalizeEvent(route.request().postDataJSON().template, key)
        : route.request().url().endsWith("/status")
          ? { configured: true }
          : account,
    }),
  );
  await page.routeWebSocket("wss://buzz.kovar.kr", (socket) => {
    socket.send(JSON.stringify(["AUTH", "embed-test"]));
    socket.onMessage((raw) => {
      const [op, id, filter] = JSON.parse(String(raw));
      if (op === "AUTH") socket.send(JSON.stringify(["OK", id.id, true, ""]));
      if (op === "REQ") {
        const kind = filter.kinds[0];
        if (kind === 39002 || kind === 39000)
          socket.send(
            JSON.stringify([
              "EVENT",
              id,
              finalizeEvent(
                {
                  kind,
                  content: "",
                  created_at: 100,
                  tags:
                    kind === 39002
                      ? [
                          ["d", "general"],
                          ["p", account.pubkey],
                        ]
                      : [
                          ["d", "general"],
                          ["name", "일반"],
                          ["t", "stream"],
                        ],
                },
                key,
              ),
            ]),
          );
        socket.send(JSON.stringify(["EOSE", id]));
      }
    });
  });
  await page.goto("/chat/#strategy");
  await page.addScriptTag({ type: "module", url: "/chat/strategy/embed.tsx" });
  await expect(page.locator(".strategy-web-pane")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "오늘 할 일", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".conversation")).not.toBeVisible();
  await expect(page.locator(".strategy-top")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await waitForAnimations(page);
  await page.screenshot({
    path: `test-results/strategy-web-embedded-${test.info().project.name}.png`,
  });
  await page.locator(".sidebar nav button").filter({ hasText: "일반" }).click();
  await expect(page.locator(".strategy-web-pane")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".strategy-web-pane")).toBeVisible();
});
