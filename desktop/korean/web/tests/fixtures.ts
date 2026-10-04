import { expect } from "@playwright/test";
import {
  finalizeEvent,
  getPublicKey,
  type EventTemplate,
  type Event,
} from "nostr-tools/pure";
async function openLegacy(page: import("@playwright/test").Page) {
  await page.locator("summary").click();
}
export const key = new Uint8Array(32).fill(1);
const relayKey = new Uint8Array(32).fill(2);
const pubkey = getPublicKey(key);
export const makeEvent = (
  kind: number,
  tags: string[][],
  content = "",
  secret = relayKey,
) => finalizeEvent({ kind, tags, content, created_at: 100 }, secret);
export const root = makeEvent(
  9,
  [["h", "general"]],
  "안녕하세요, 팀 여러분!",
  key,
);

export async function installRelay(
  page: import("@playwright/test").Page,
  rejectFirst = false,
  history: Event[] = [root],
  channelIds = ["general"],
) {
  let rejected = false;
  const published: Event[] = [];
  await page.routeWebSocket("wss://buzz.kovar.kr", (socket) => {
    const subscriptions = new Map<string, Record<string, unknown>>();
    socket.send(JSON.stringify(["AUTH", "browser-test-challenge"]));
    socket.onMessage((data) => {
      const [kind, id, filter] = JSON.parse(String(data));
      if (kind === "AUTH") socket.send(JSON.stringify(["OK", id.id, true, ""]));
      if (kind === "REQ") {
        subscriptions.set(id, filter);
        const send = (event: Event) =>
          socket.send(JSON.stringify(["EVENT", id, event]));
        if (filter.kinds[0] === 39002)
          for (const channel of channelIds)
            send(
              makeEvent(39002, [
                ["d", channel],
                ["p", pubkey],
              ]),
            );
        if (filter.kinds[0] === 39000)
          for (const channel of channelIds)
            send(
              makeEvent(39000, [
                ["d", channel],
                ["name", channel === "general" ? "일반" : channel],
                ["t", "stream"],
              ]),
            );
        if (filter.kinds[0] === 0)
          send(makeEvent(0, [], JSON.stringify({ name: "테스트 직원" }), key));
        if (filter.kinds.includes(9))
          for (const event of history) {
            if (
              event.tags.some(
                (parts) => parts[0] === "h" && filter["#h"].includes(parts[1]),
              )
            )
              send(event);
          }
        socket.send(JSON.stringify(["EOSE", id]));
      }
      if (kind === "CLOSE") subscriptions.delete(id);
      if (kind === "EVENT") {
        published.push(id);
        if (rejectFirst && !rejected) {
          rejected = true;
          socket.send(JSON.stringify(["OK", id.id, false, "test rejection"]));
          return;
        }
        socket.send(JSON.stringify(["OK", id.id, true, ""]));
        for (const [subscriptionId, subscription] of subscriptions) {
          if ((subscription.kinds as number[]).includes(9))
            socket.send(JSON.stringify(["EVENT", subscriptionId, id]));
        }
      }
    });
  });
  return published;
}

export async function signInWithExtension(
  page: import("@playwright/test").Page,
) {
  await page.exposeFunction("fixtureSign", (template: EventTemplate) =>
    finalizeEvent(template, key),
  );
  await page.addInitScript((pubkey) => {
    window.nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async (template) => {
        return (
          window as unknown as {
            fixtureSign(event: EventTemplate): Promise<Event>;
          }
        ).fixtureSign(template);
      },
    };
  }, pubkey);
  await page.goto("/chat/");
  await openLegacy(page);
  await page
    .getByRole("button", { name: "브라우저 서명 확장으로 로그인" })
    .click();
  await expect(page.getByRole("log")).toBeVisible();
  const back = page.getByRole("button", { name: "채널 목록", exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByRole("button", { name: "일반", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("안녕하세요, 팀 여러분!");
}
