import type { Event, EventTemplate } from "nostr-tools/pure";
import { checkedEvent, type Signer } from "./signer";
import { atServerTime, checkedServerTime } from "./server-time";
export interface WebAccount {
  username: string;
  name: string;
  pubkey: string;
  role: "admin" | "member";
  mustChangePassword: boolean;
  status: "ready" | "pending" | "failed";
  provisioningError: string;
  mfaEnabled?: boolean;
  recoveryCodesRemaining?: number;
}

type ApiTransport = <T>(route: string, input?: object) => Promise<T>;
let nativeTransport: ApiTransport | undefined;
/** Select a memory-only desktop transport; the web entry keeps its cookie transport. */
export function setNativeLoginTransport(transport: ApiTransport | undefined) {
  nativeTransport = transport;
}

/** Same-origin, cookie authenticated API; credentials never enter browser storage. */
export async function loginApi<T>(route: string, input?: object): Promise<T> {
  if (nativeTransport) return nativeTransport<T>(route, input);
  const response = await fetch(`/chat-api/${route}`, {
    method: input ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
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
      const now = checkedServerTime(
        await loginApi<{ serverTime: number }>("status"),
      );
      if (!active) throw new Error("locked");
      const approved = atServerTime(template, now);
      const event = await loginApi<Event>("sign", { template: approved });
      if (!active) throw new Error("locked");
      return checkedEvent(approved, event, account.pubkey);
    },
    dispose() {
      active = false;
    },
  };
}

export interface MfaChallenge {
  challenge: string;
  secret: string;
  uri: string;
  recoveryCodes: string[];
}
export interface MfaConfirmation {
  mfaChallenge: string;
  mfaCode: string;
  recoverySaved: true;
}
export interface MfaEnrollmentResult {
  mfaEnrollment: MfaChallenge;
}
