import type { Signer } from "./signer";
import {
  attachmentName,
  MAX_FILE_BYTES,
  mediaAuthTemplate,
  mediaUrl,
  type Attachment,
} from "./media-protocol";

async function sha256(bytes: ArrayBuffer): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function authorization(
  signer: Signer,
  relay: string,
  hash: string,
  verb: "upload" | "get",
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const event = await signer.sign(mediaAuthTemplate(relay, hash, verb));
  signal.throwIfAborted();
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

function requestError(status: number): Error {
  return new Error(
    status === 413
      ? "file-too-large"
      : status === 401 || status === 403
        ? "media-access-denied"
        : status === 415
          ? "file-type-rejected"
          : "media-request-failed",
  );
}

/** Upload exact bytes to the relay using the current identity; cancellation prevents late dispatch. */
export async function uploadAttachment(
  file: File,
  signer: Signer,
  relay: string,
  signal: AbortSignal,
): Promise<Attachment> {
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw new Error("file-too-large");
  signal.throwIfAborted();
  const bytes = await file.arrayBuffer();
  const hash = await sha256(bytes);
  const auth = await authorization(signer, relay, hash, "upload", signal);
  const url = new URL("/upload", relay.replace(/^ws/, "http"));
  const response = await fetch(url, {
    method: "PUT",
    body: bytes,
    signal,
    redirect: "error",
    credentials: "omit",
    headers: {
      Authorization: auth,
      "Content-Type": file.type || "application/octet-stream",
    },
  });
  if (!response.ok) throw requestError(response.status);
  const descriptor = await response.json();
  const blobUrl = mediaUrl(descriptor.url, relay);
  if (
    descriptor.sha256 !== hash ||
    blobUrl.pathname.slice(7, 71) !== hash ||
    descriptor.size !== file.size ||
    typeof descriptor.type !== "string" ||
    !/^[\w.+-]+\/[\w.+-]+$/.test(descriptor.type)
  )
    throw new Error("invalid-media");
  return {
    url: blobUrl.href,
    sha256: hash,
    size: file.size,
    type: descriptor.type,
    filename: attachmentName(file.name),
  };
}

/** Fetch authenticated bytes with a strict size bound and integrity check before saving. */
export async function downloadAttachment(
  file: Attachment,
  signer: Signer,
  relay: string,
  signal: AbortSignal,
): Promise<Blob> {
  const url = mediaUrl(file.url, relay);
  if (file.size && file.size > MAX_FILE_BYTES)
    throw new Error("file-too-large");
  const auth = await authorization(signer, relay, file.sha256, "get", signal);
  const response = await fetch(url, {
    headers: { Authorization: auth },
    signal,
    redirect: "error",
    credentials: "omit",
  });
  if (!response.ok) throw requestError(response.status);
  if (!response.body) throw new Error("media-request-failed");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get("Content-Length")) > MAX_FILE_BYTES)
      throw new Error("file-too-large");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) throw new Error("file-too-large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const blob = new Blob(chunks, { type: "application/octet-stream" });
  if (
    (file.size && size !== file.size) ||
    (await sha256(await blob.arrayBuffer())) !== file.sha256
  )
    throw new Error("invalid-media");
  signal.throwIfAborted();
  return blob;
}

/** Ask the browser to save a blob with its original filename; release the temporary URL. */
export function saveAttachment(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = attachmentName(filename);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
