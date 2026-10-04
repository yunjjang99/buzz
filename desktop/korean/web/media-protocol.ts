import type { EventTemplate } from "nostr-tools/pure";

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
export type Attachment = {
  url: string;
  sha256: string;
  size?: number;
  type: string;
  filename: string;
};

/** Keep attachment names safe for markdown, Nostr tags, and browser downloads. */
export function attachmentName(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}/\\]/gu, "_")
    .trim();
  let result = "";
  let size = 0;
  const encoder = new TextEncoder();
  for (const character of cleaned) {
    size += encoder.encode(character).length;
    if (size > 255) break;
    result += character;
  }
  return result || "file";
}

/** Accept only original blobs belonging to the current relay, never arbitrary URLs. */
export function mediaUrl(value: string, relay: string): URL {
  const origin = new URL(relay.replace(/^ws/, "http"));
  const url = new URL(value);
  if (
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/media\/[a-f0-9]{64}(?:\.[a-z0-9]+)?$/.test(url.pathname)
  )
    throw new Error("invalid-media");
  return url;
}

/** Create a short-lived, host- and hash-bound Blossom upload/read proof. */
export function mediaAuthTemplate(
  relay: string,
  hash: string,
  verb: "upload" | "get",
): EventTemplate {
  const created_at = Math.floor(Date.now() / 1000);
  const template = {
    kind: 24242,
    created_at,
    content: "Buzz file transfer",
    tags: [
      ["t", verb],
      ["x", hash],
      ["server", new URL(relay).hostname],
      ["expiration", String(created_at + 60)],
    ],
  };
  if (!validMediaAuth(template, relay, created_at))
    throw new Error("invalid-media");
  return template;
}

/** Restrict custodial/worker signing to one blob and this community for at most 60 seconds. */
export function validMediaAuth(
  template: EventTemplate,
  relay: string,
  now: number,
): boolean {
  const [verb, hash, server, expiry] = template.tags;
  return (
    template.kind === 24242 &&
    template.content === "Buzz file transfer" &&
    Number.isInteger(template.created_at) &&
    Math.abs(template.created_at - now) <= 60 &&
    template.tags.length === 4 &&
    template.tags.every((parts) => parts.length === 2) &&
    verb[0] === "t" &&
    ["upload", "get"].includes(verb[1]) &&
    hash[0] === "x" &&
    /^[a-f0-9]{64}$/.test(hash[1]) &&
    server[0] === "server" &&
    server[1] === new URL(relay).hostname &&
    expiry[0] === "expiration" &&
    /^\d+$/.test(expiry[1]) &&
    Number(expiry[1]) > now &&
    Number(expiry[1]) <= now + 60 &&
    Number(expiry[1]) <= template.created_at + 60
  );
}

/** Encode the same NIP-92 metadata and markdown used by the native clients. */
export function attachmentTag(file: Attachment): string[] {
  return [
    "imeta",
    `url ${file.url}`,
    `m ${file.type}`,
    `x ${file.sha256}`,
    ...(file.size ? [`size ${file.size}`] : []),
    `filename ${file.filename}`,
  ];
}

/** Include media URLs in the body so desktop and mobile render attachments too. */
export function attachmentMarkdown(file: Attachment): string {
  if (file.type.startsWith("image/")) return `![image](${file.url})`;
  if (file.type.startsWith("video/")) return `![video](${file.url})`;
  return `[${file.filename.replace(/[\\[\]]/g, "\\$&")}](${file.url})`;
}

/** Read bounded, current-body attachments; stale edit metadata must not resurrect removed files. */
export function messageAttachments(
  message: { content: string; tags: string[][] },
  relay: string,
): Attachment[] {
  const files = new Map<string, Attachment>();
  for (const parts of message.tags) {
    if (parts[0] !== "imeta" || files.size >= 20) continue;
    const field = (name: string) =>
      parts
        .slice(1)
        .find((value) => value.startsWith(`${name} `))
        ?.slice(name.length + 1);
    const value = field("url");
    if (!value || !message.content.includes(value)) continue;
    try {
      const url = mediaUrl(value, relay);
      const hash = url.pathname.slice(7, 71);
      if (field("x") && field("x") !== hash) continue;
      const size = Number(field("size"));
      files.set(url.href, {
        url: url.href,
        sha256: hash,
        type: field("m") ?? "application/octet-stream",
        filename: attachmentName(field("filename") ?? url.pathname.slice(7)),
        size: Number.isSafeInteger(size) && size > 0 ? size : undefined,
      });
    } catch {
      /* Untrusted/foreign metadata remains visible as plain message text. */
    }
  }
  return [...files.values()];
}

/** Hide only standalone attachment markdown already represented by a download card. */
export function messageText(
  message: { content: string; tags: string[][] },
  relay: string,
): string {
  const urls = new Set(
    messageAttachments(message, relay).map((file) => file.url),
  );
  if (!urls.size) return message.content;
  return message.content
    .split("\n")
    .filter((line) => {
      const match = /^!?\[(?:\\.|[^\]\\])*\]\(([^)\s]+)\)\s*$/.exec(line);
      return !match || !urls.has(match[1]);
    })
    .join("\n")
    .trim();
}
