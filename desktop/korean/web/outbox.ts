import { verifyEvent, type Event } from "nostr-tools/pure";
import { assertNoKeys, KINDS, tag } from "./protocol";

const KEY = "buzz-korean-web.outbox.v1";
type Outbox = { relay: string; event: Event };

/** Read a bounded tab-local retry journal scoped to both account and relay. */
export function readOutbox(relay: string, pubkey: string): Event | null {
  const value = sessionStorage.getItem(KEY);
  if (!value) return null;
  if (value.length > 100_000) throw new Error("invalid-outbox");
  const record: Outbox = JSON.parse(value);
  if (record.relay !== relay || record.event.pubkey !== pubkey) return null;
  if (
    record.event.kind !== KINDS.message ||
    !tag(record.event, "h") ||
    !verifyEvent(record.event)
  )
    throw new Error("invalid-outbox");
  assertNoKeys(record.event.content);
  return record.event;
}

/** Save one signed event before sending; storage failure prevents transmission. */
export function saveOutbox(relay: string, event: Event): void {
  assertNoKeys(event.content);
  const previous = sessionStorage.getItem(KEY);
  if (previous && (JSON.parse(previous) as Outbox).event.id !== event.id)
    throw new Error("outbox-already-pending");
  const value = JSON.stringify({ relay, event });
  if (value.length > 100_000) throw new Error("invalid-outbox");
  sessionStorage.setItem(KEY, value);
}

/** Clear only the acknowledged event; never clear a different account's retry. */
export function acknowledgeOutbox(eventId: string): void {
  const previous = sessionStorage.getItem(KEY);
  if (previous && (JSON.parse(previous) as Outbox).event.id === eventId)
    sessionStorage.removeItem(KEY);
}
