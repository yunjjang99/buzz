import type { EventTemplate } from "nostr-tools/pure";

/** Obtain fresh UTC seconds from the same-origin login service, never the device clock. */
export async function readServerTime(): Promise<number> {
  const response = await fetch("/chat-api/status", {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("server-time-unavailable");
  return checkedServerTime(await response.json());
}

/** Reject missing/old server versions instead of silently falling back to local time. */
export function checkedServerTime(value: { serverTime?: number }): number {
  if (!Number.isSafeInteger(value?.serverTime) || Number(value.serverTime) <= 0)
    throw new Error("server-time-unavailable");
  return Number(value.serverTime);
}

/** Rebase a new unsigned operation, preserving the exact 60-second media lifetime. */
export function atServerTime(
  template: EventTemplate,
  now: number,
): EventTemplate {
  checkedServerTime({ serverTime: now });
  let tags = template.tags;
  if (template.kind === 24242) {
    const expires = tags.filter((tag) => tag[0] === "expiration");
    if (
      expires.length !== 1 ||
      expires[0].length !== 2 ||
      !/^\d+$/.test(expires[0][1]) ||
      Number(expires[0][1]) !== template.created_at + 60
    )
      throw new Error("invalid-media");
    tags = tags.map((tag) =>
      tag[0] === "expiration" ? ["expiration", String(now + 60)] : [...tag],
    );
  }
  return { ...template, created_at: now, tags };
}
