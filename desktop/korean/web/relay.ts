import { matchFilter, type Filter } from "nostr-tools/filter";
import { verifyEvent, type Event, type EventTemplate } from "nostr-tools/pure";
import type { Signer } from "./signer";

type Subscription = {
  filter: Filter;
  event(event: Event): void;
  ready(): void;
  error(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};
type Publish = {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/** NIP-42 authenticated connection with bounded subscriptions and explicit recovery. */
export class Relay {
  private socket: WebSocket;
  private signer: Signer;
  private url: string;
  private active = true;
  private authenticated = false;
  private authGeneration = 0;
  private authId = "";
  private authTimer: ReturnType<typeof setTimeout>;
  private authResolve: () => void = () => {};
  private authReject: (error: Error) => void = () => {};
  private disconnected: (error: Error) => void;
  private subscriptions = new Map<string, Subscription>();
  private publishes = new Map<string, Publish>();
  readonly ready: Promise<void>;

  constructor(
    url: string,
    signer: Signer,
    disconnected: (error: Error) => void,
  ) {
    this.url = url;
    this.signer = signer;
    this.disconnected = disconnected;
    this.ready = new Promise((resolve, reject) => {
      this.authResolve = resolve;
      this.authReject = reject;
    });
    this.socket = new WebSocket(url);
    this.authTimer = setTimeout(
      () => this.fail(new Error("authentication-timeout")),
      20_000,
    );
    this.socket.onmessage = (message) => {
      this.receive(message).catch((error) => this.fail(asError(error)));
    };
    this.socket.onerror = () => this.fail(new Error("connection-failed"));
    this.socket.onclose = () => this.fail(new Error("connection-closed"));
  }

  private async receive(message: MessageEvent) {
    if (!this.active || typeof message.data !== "string") return;
    if (message.data.length > 1024 * 1024)
      throw new Error("oversized-relay-frame");
    let frame: unknown;
    try {
      frame = JSON.parse(message.data);
    } catch {
      throw new Error("invalid-relay-frame");
    }
    if (!Array.isArray(frame)) return;
    const [type, id, value, reason] = frame;
    if (type === "AUTH" && typeof id === "string") {
      const generation = ++this.authGeneration;
      const signed = await this.signer.sign({
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["relay", this.url],
          ["challenge", id],
        ],
      });
      if (!this.active || generation !== this.authGeneration) return;
      this.authId = signed.id;
      this.socket.send(JSON.stringify(["AUTH", signed]));
    } else if (type === "OK" && id === this.authId) {
      if (value !== true)
        throw new Error(
          typeof reason === "string" ? reason : "authentication-rejected",
        );
      clearTimeout(this.authTimer);
      this.authenticated = true;
      this.authResolve();
    } else if (type === "OK" && typeof id === "string") {
      const pending = this.publishes.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.publishes.delete(id);
      if (value === true) pending.resolve();
      else
        pending.reject(
          new Error(typeof reason === "string" ? reason : "message-rejected"),
        );
    } else if (type === "EVENT" && typeof id === "string") {
      const subscription = this.subscriptions.get(id);
      if (!subscription || !value || typeof value !== "object") return;
      let valid = false;
      try {
        valid =
          verifyEvent(value as Event) &&
          matchFilter(subscription.filter, value as Event);
      } catch {
        valid = false;
      }
      if (!valid) throw new Error("invalid-relay-event");
      subscription.event(value as Event);
    } else if (type === "EOSE" && typeof id === "string") {
      const subscription = this.subscriptions.get(id);
      if (subscription) {
        clearTimeout(subscription.timer);
        subscription.ready();
      }
    } else if (type === "CLOSED" && typeof id === "string") {
      const subscription = this.subscriptions.get(id);
      if (subscription) {
        clearTimeout(subscription.timer);
        this.subscriptions.delete(id);
        subscription.error(
          new Error(
            typeof value === "string" ? value : "subscription-rejected",
          ),
        );
      }
    }
  }

  /** One continuous REQ covers both initial history and live messages. */
  subscribe(
    filter: Filter,
    event: (event: Event) => void,
    ready: () => void,
    error: (error: Error) => void,
  ): () => void {
    if (!this.active || !this.authenticated) throw new Error("not-connected");
    if (!filter.kinds?.length || this.subscriptions.size >= 16)
      throw new Error("invalid-subscription");
    const id = crypto.randomUUID();
    const cancel = () => {
      const subscription = this.subscriptions.get(id);
      if (!subscription) return;
      clearTimeout(subscription.timer);
      this.subscriptions.delete(id);
      if (this.active && this.socket.readyState === WebSocket.OPEN)
        this.socket.send(JSON.stringify(["CLOSE", id]));
    };
    const timer = setTimeout(() => {
      cancel();
      error(new Error("history-timeout"));
    }, 20_000);
    this.subscriptions.set(id, { filter, event, ready, error, timer });
    this.socket.send(JSON.stringify(["REQ", id, filter]));
    return cancel;
  }

  /** Finite authenticated read, bounded by caller limit and a readiness timeout. */
  query(filter: Filter): Promise<Event[]> {
    return new Promise((resolve, reject) => {
      const events: Event[] = [];
      const cancel = this.subscribe(
        filter,
        (event) => {
          if (events.length >= (filter.limit ?? 1000)) {
            cancel();
            reject(new Error("query-limit-exceeded"));
            return;
          }
          events.push(event);
        },
        () => {
          cancel();
          resolve(events);
        },
        reject,
      );
    });
  }

  /** A publish succeeds only after a positive relay OK for that exact event ID. */
  async prepare(template: EventTemplate): Promise<Event> {
    if (!this.active || !this.authenticated || this.publishes.size >= 8)
      throw new Error("not-connected");
    const signed = await this.signer.sign(template);
    if (!this.active || !this.authenticated) throw new Error("not-connected");
    return signed;
  }

  /** Retry the same signed event ID after an uncertain delivery outcome. */
  async deliver(signed: Event): Promise<void> {
    if (
      !this.active ||
      !this.authenticated ||
      signed.pubkey !== this.signer.pubkey ||
      !verifyEvent(signed)
    )
      throw new Error("not-connected");
    await new Promise<void>((resolve, reject) => {
      const previous = this.publishes.get(signed.id);
      if (previous) {
        reject(new Error("publish-already-pending"));
        return;
      }
      const timer = setTimeout(() => {
        this.publishes.delete(signed.id);
        reject(new Error("publish-timeout"));
      }, 15_000);
      this.publishes.set(signed.id, { resolve, reject, timer });
      this.socket.send(JSON.stringify(["EVENT", signed]));
    });
  }

  private fail(error: Error) {
    if (!this.active) return;
    this.dispose();
    this.disconnected(error);
  }

  /** Close all resources; pending operations reject rather than report partial success. */
  dispose() {
    if (!this.active) return;
    this.active = false;
    this.authenticated = false;
    ++this.authGeneration;
    clearTimeout(this.authTimer);
    this.authReject(new Error("connection-closed"));
    for (const pending of this.publishes.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("connection-closed"));
    }
    for (const subscription of this.subscriptions.values()) {
      clearTimeout(subscription.timer);
      subscription.error(new Error("connection-closed"));
    }
    this.publishes.clear();
    this.subscriptions.clear();
    this.socket.close();
  }
}

/** Normalize failures without treating them as empty history or success. */
export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("operation-failed");
}
