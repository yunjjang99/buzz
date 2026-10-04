import type { Event, EventTemplate } from "nostr-tools/pure";
import { checkedEvent, type Signer } from "./signer";
export interface WebAccount {
  username: string;
  name: string;
  pubkey: string;
  role: "admin" | "member";
  mustChangePassword: boolean;
  status: "ready" | "pending" | "failed";
  provisioningError: string;
}

type ApiTransport = <T>(route: string, input?: object) => Promise<T>;
let nativeTransport: ApiTransport | undefined;
/** Select a memory-only desktop transport; the web entry keeps its cookie transport. */
export function setNativeLoginTransport(transport: ApiTransport) {
  nativeTransport = transport;
}

/** Same-origin, cookie authenticated API; credentials never enter browser storage. */
export async function loginApi<T>(route: string, input?: object): Promise<T> {
  if (nativeTransport) return nativeTransport<T>(route, input);
  const response = await fetch(`/chat-api/${route}`, {
    method: input ? "POST" : "GET",
    credentials: "same-origin",
    redirect: "error",
    signal: AbortSignal.timeout(40000),
    headers: input ? { "Content-Type": "application/json" } : {},
    body: input ? JSON.stringify(input) : undefined,
  });
  let result: { error?: string; retryAfter?: number };
  try {
    result = await response.json();
  } catch {
    throw new Error("login-service-unavailable");
  }
  if (!response.ok)
    throw Object.assign(
      new Error(result.error ?? "login-service-unavailable"),
      {
        retryAfter: result.retryAfter,
      },
    );
  return result as T;
}

/** Ask the home server to sign only supported operations for the exact signed-in identity. */
export function accountSigner(account: WebAccount): Signer {
  let active = true;
  return {
    pubkey: account.pubkey,
    async sign(template: EventTemplate) {
      if (!active) throw new Error("locked");
      const event = await loginApi<Event>("sign", { template });
      if (!active) throw new Error("locked");
      return checkedEvent(template, event, account.pubkey);
    },
    dispose() {
      active = false;
    },
  };
}
