import type { Event } from "nostr-tools/pure";
import { verifyEvent } from "nostr-tools/pure";
import type { Relay } from "../relay";
import { MAIL_CHANNEL, TASK_TAG, getTag } from "./model";

/** Read bounded history with an inclusive timestamp overlap; disclose saturated boundaries. */
export async function readHistory(
  client: Pick<Relay, "query">,
): Promise<{ events: Event[]; limited: boolean }> {
  const records = new Map<string, Event>();
  let until: number | undefined;
  for (let page = 0; page < 40; page++) {
    const batch = await client.query({
      kinds: [9],
      "#h": [MAIL_CHANNEL],
      limit: 250,
      ...(until === undefined ? {} : { until }),
    });
    for (const event of batch) records.set(event.id, event);
    if (batch.length < 250)
      return { events: [...records.values()], limited: false };
    const oldest = Math.min(...batch.map((event) => event.created_at));
    if (oldest === until)
      return { events: [...records.values()], limited: true };
    until = oldest;
  }
  return { events: [...records.values()], limited: true };
}
const key = (relay: string, pubkey: string) =>
  `buzz.strategy.pending.v1:${relay}:${pubkey}`;
/** Persist the exact signed operation before transport, retaining it across reloads and failures. */
export function journal(relay: string, event: Event) {
  const previous = pending(relay, event.pubkey);
  if (previous && previous.id !== event.id)
    throw new Error("먼저 저장 대기 중인 업무를 재시도하세요.");
  localStorage.setItem(key(relay, event.pubkey), JSON.stringify(event));
}
/** Restore and validate the exact account-scoped operation awaiting acknowledgment. */
export function pending(relay: string, pubkey: string): Event | null {
  const value = localStorage.getItem(key(relay, pubkey));
  if (!value) return null;
  if (value.length > 20000)
    throw new Error("저장 대기 기록을 확인할 수 없습니다.");
  const event: Event = JSON.parse(value);
  if (
    event.pubkey !== pubkey ||
    event.kind !== 9 ||
    getTag(event, "h") !== MAIL_CHANNEL ||
    getTag(event, "t") !== TASK_TAG ||
    !verifyEvent(event)
  )
    throw new Error("저장 대기 기록 검증에 실패했습니다.");
  return event;
}
/** Clear only the operation whose relay acknowledgment has been verified. */
export function acknowledged(relay: string, event: Event) {
  if (pending(relay, event.pubkey)?.id === event.id)
    localStorage.removeItem(key(relay, event.pubkey));
}
