import { verifyEvent, type Event, type EventTemplate } from "nostr-tools/pure";
import { validateBackup } from "./protocol";
import { atServerTime, readServerTime } from "./server-time";

export interface Signer {
  pubkey: string;
  sign(template: EventTemplate): Promise<Event>;
  dispose(): void;
}
type Provider = {
  getPublicKey(): Promise<string>;
  signEvent(template: EventTemplate): Promise<Event>;
};
declare global {
  interface Window {
    nostr?: Provider;
  }
}

/** Require a stable, valid public key from every supported browser identity. */
export function validPublicKey(pubkey: string): string {
  if (!/^[a-f0-9]{64}$/.test(pubkey)) throw new Error("invalid-identity");
  return pubkey;
}

/** Validate the signature and exact approved event, including its account identity. */
export function checkedEvent(
  template: EventTemplate,
  event: Event,
  pubkey: string,
): Event {
  if (
    event.pubkey !== pubkey ||
    event.kind !== template.kind ||
    event.created_at !== template.created_at ||
    event.content !== template.content ||
    JSON.stringify(event.tags) !== JSON.stringify(template.tags) ||
    !verifyEvent(event)
  ) {
    throw new Error("invalid-signature");
  }
  return event;
}

/** Use an existing NIP-07 extension; never generate a disposable membership identity. */
export async function extensionSigner(): Promise<Signer> {
  const provider = window.nostr;
  if (!provider) throw new Error("extension-required");
  const pubkey = validPublicKey(await provider.getPublicKey());
  let active = true;
  return {
    pubkey,
    async sign(template) {
      if (!active) throw new Error("locked");
      const approved = atServerTime(template, await readServerTime());
      if (!active) throw new Error("locked");
      const event = await provider.signEvent(approved);
      if (!active) throw new Error("locked");
      return checkedEvent(approved, event, pubkey);
    },
    dispose() {
      active = false;
    },
  };
}

/** Hold the recovered key only in a bounded, terminable worker for this tab. */
export async function backupSigner(
  backup: string,
  password: string,
): Promise<Signer> {
  const normalized = validateBackup(backup);
  const worker = new Worker(new URL("./key.worker.ts", import.meta.url), {
    type: "module",
  });
  let sequence = 0;
  let active = true;
  const pending = new Map<
    number,
    {
      resolve(result: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const dispose = () => {
    active = false;
    worker.terminate();
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("locked"));
    }
    pending.clear();
  };
  worker.onmessage = (
    message: MessageEvent<{ id: number; result?: unknown; error?: string }>,
  ) => {
    const entry = pending.get(message.data.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.data.id);
    if (message.data.error) entry.reject(new Error(message.data.error));
    else entry.resolve(message.data.result);
  };
  worker.onerror = () => dispose();
  const request = (operation: string, values: object): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (!active || pending.size >= 8) {
        reject(new Error("signer-unavailable"));
        return;
      }
      const id = ++sequence;
      const timer = setTimeout(() => {
        dispose();
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, operation, ...values });
    });
  try {
    const pubkey = validPublicKey(
      String(await request("unlock", { backup: normalized, password })),
    );
    return {
      pubkey,
      async sign(template) {
        const approved = atServerTime(template, await readServerTime());
        return checkedEvent(
          approved,
          (await request("sign", { template: approved })) as Event,
          pubkey,
        );
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
