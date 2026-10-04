import type { Event, EventTemplate } from "nostr-tools/pure";

export const KINDS = {
  profile: 0,
  message: 9,
  legacyMessage: 40002,
  edit: 40003,
  deletion: 5,
  metadata: 39000,
  members: 39002,
  auth: 22242,
} as const;
export const MESSAGE_KINDS = [
  KINDS.message,
  KINDS.legacyMessage,
  KINDS.edit,
  KINDS.deletion,
];
export const MAX_EVENTS = 600;

export type Channel = { id: string; name: string; about: string; type: string };
export type ChatMessage = Event & { edited?: boolean; deleted?: boolean };

/** Read a Nostr tag without interpreting user-authored content. */
export function tag(event: Event, name: string): string {
  return event.tags.find((parts) => parts[0] === name)?.[1] ?? "";
}

/** Keep the newest addressable record per d-tag, using the NIP-01 ID tie-break. */
export function newestByAddress(events: Event[]): Event[] {
  const records = new Map<string, Event>();
  for (const event of events) {
    const address = tag(event, "d");
    if (!address) continue;
    const previous = records.get(address);
    if (
      !previous ||
      event.created_at > previous.created_at ||
      (event.created_at === previous.created_at && event.id < previous.id)
    )
      records.set(address, event);
  }
  return [...records.values()];
}

/** Display only memberships and channel metadata visible to this authenticated key. */
export function memberChannels(
  memberships: Event[],
  metadata: Event[],
  pubkey: string,
): Channel[] {
  const ids = new Set(
    newestByAddress(memberships)
      .filter((event) =>
        event.tags.some((parts) => parts[0] === "p" && parts[1] === pubkey),
      )
      .map((event) => tag(event, "d")),
  );
  return newestByAddress(metadata)
    .filter(
      (event) => ids.has(tag(event, "d")) && tag(event, "archived") !== "true",
    )
    .map((event) => ({
      id: tag(event, "d"),
      name: tag(event, "name") || tag(event, "d"),
      about: tag(event, "about") || tag(event, "topic"),
      type: tag(event, "t") || "stream",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Fold only author-owned edits/deletions into an explicitly channel-scoped timeline. */
export function timeline(events: Event[], channel: string): ChatMessage[] {
  const scoped = events.filter((event) => tag(event, "h") === channel);
  const messages = scoped.filter(
    (event) =>
      event.kind === KINDS.message || event.kind === KINDS.legacyMessage,
  );
  return messages
    .map((message) => {
      const edits = scoped
        .filter(
          (event) =>
            event.kind === KINDS.edit &&
            event.pubkey === message.pubkey &&
            tag(event, "e") === message.id &&
            event.created_at >= message.created_at,
        )
        .sort(
          (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
        );
      const deleted = scoped.some(
        (event) =>
          event.kind === KINDS.deletion &&
          event.pubkey === message.pubkey &&
          event.created_at >= message.created_at &&
          event.tags.some(
            (parts) => parts[0] === "e" && parts[1] === message.id,
          ),
      );
      return {
        ...message,
        content: edits[0]?.content ?? message.content,
        tags: edits[0]
          ? [
              ...message.tags.filter((parts) => parts[0] !== "imeta"),
              ...(edits[0].tags.some((parts) => parts[0] === "imeta")
                ? edits[0].tags
                : message.tags
              ).filter((parts) => parts[0] === "imeta"),
            ]
          : message.tags,
        edited: Boolean(edits[0]),
        deleted,
      };
    })
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
}

/** Bounded deduplication shared by history and the continuous live subscription. */
export function retainEvent(events: Event[], incoming: Event): Event[] {
  if (events.some((event) => event.id === incoming.id)) return events;
  return [...events, incoming]
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
    .slice(-MAX_EVENTS);
}

/** Return the actual containing root for the supported stream reply tags. */
export function threadRoot(message: Event): string {
  return (
    message.tags.find(
      (parts) => parts[0] === "e" && parts[3] === "root",
    )?.[1] ||
    message.tags.find(
      (parts) => parts[0] === "e" && parts[3] === "reply",
    )?.[1] ||
    message.id
  );
}

/** Build desktop-compatible channel and thread tags, preserving plain message text. */
export function messageTemplate(
  channel: string,
  content: string,
  reply?: Event,
): EventTemplate {
  const text = content.trim();
  if (!channel || !text || new TextEncoder().encode(text).length > 64 * 1024)
    throw new Error("invalid-message");
  assertNoKeys(text);
  const tags = [["h", channel]];
  if (reply) {
    if (tag(reply, "h") !== channel) throw new Error("wrong-channel");
    const root = threadRoot(reply);
    if (root !== reply.id) tags.push(["e", root, "", "root"]);
    tags.push(["e", reply.id, "", "reply"]);
  }
  tags.push(["client", "Buzz Korean Web"]);
  return {
    kind: KINDS.message,
    created_at: Math.floor(Date.now() / 1000),
    content: text,
    tags,
  };
}

/** Block accidental transmission of raw or encrypted account keys as chat text. */
export function assertNoKeys(content: string): void {
  if (/\b(?:ncryptsec1|nsec1)[a-z0-9]{20,}/i.test(content))
    throw new Error("key-in-message");
}

/** Inspect NIP-49 cost before its synchronous KDF is allowed to allocate memory. */
export function validateBackup(input: string): string {
  const trimmed = input.trim();
  if (
    trimmed.length > 256 ||
    (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase())
  )
    throw new Error("invalid-backup");
  const normalized = trimmed.toLowerCase();
  if (!normalized.startsWith("ncryptsec1"))
    throw new Error("encrypted-backup-required");
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (const character of normalized.slice(10, -6)) {
    const word = alphabet.indexOf(character);
    if (word === -1) throw new Error("invalid-backup");
    value = ((value << 5) | word) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
    }
  }
  if (bytes.length !== 91 || bytes[0] !== 2 || bytes[1] < 1 || bytes[1] > 18)
    throw new Error("unsupported-backup");
  return normalized; // nip49.decrypt verifies the full bech32 checksum before its KDF.
}
