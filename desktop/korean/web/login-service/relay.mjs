import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { finalizeEvent, verifyEvent } from "nostr-tools/pure";
const sha = (data) => createHash("sha256").update(data).digest("hex");

/** Preserve canonical host and signed NIP-98 admission on the existing HTTP bridge. */
export class RelayBridge {
  constructor(origin, internal = origin) {
    this.origin = origin;
    this.internal = internal;
  }
  async request(secret, route, payload) {
    const body = JSON.stringify(payload);
    const auth = finalizeEvent(
      {
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["u", `${this.origin}${route}`],
          ["method", "POST"],
          ["payload", sha(body)],
          ["nonce", randomBytes(16).toString("hex")],
        ],
      },
      secret,
    );
    const url = new URL(`${this.internal}${route}`);
    return await new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            Host: new URL(this.origin).host,
            Authorization: `Nostr ${Buffer.from(JSON.stringify(auth)).toString("base64")}`,
          },
        },
      );
      const timer = setTimeout(
        () => request.destroy(new Error("relay-timeout")),
        10000,
      );
      let finished = false;
      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      request.on("error", (error) => finish(error));
      request.on("response", (response) => {
        if (response.statusCode !== 200) {
          finish(new Error("relay-rejected"));
          response.destroy();
          return;
        }
        const pieces = [];
        let bytes = 0;
        response.on("data", (piece) => {
          bytes += piece.length;
          if (bytes > 2 * 1024 * 1024) {
            finish(new Error("relay-response-too-large"));
            response.destroy();
            return;
          }
          pieces.push(piece);
        });
        response.on("error", (error) => finish(error));
        response.on("end", () => {
          try {
            finish(null, JSON.parse(Buffer.concat(pieces).toString("utf8")));
          } catch {
            finish(new Error("invalid-relay-response"));
          }
        });
      });
      request.end(body);
    });
  }
  async query(secret, filter) {
    const result = await this.request(secret, "/query", [filter]);
    if (
      !Array.isArray(result) ||
      result.length > 1000 ||
      result.some((event) => !verifyEvent(event))
    )
      throw new Error("invalid-relay-response");
    return result;
  }
  async publish(secret, event) {
    const result = await this.request(secret, "/events", event);
    if (result.accepted !== true || result.event_id !== event.id)
      throw new Error("relay-rejected");
  }
}
