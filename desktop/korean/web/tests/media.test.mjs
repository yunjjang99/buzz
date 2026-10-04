import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachmentMarkdown,
  attachmentName,
  attachmentTag,
  mediaAuthTemplate,
  mediaUrl,
  messageAttachments,
  messageText,
  validMediaAuth,
} from "../media-protocol.ts";
import { timeline } from "../protocol.ts";
import { downloadAttachment, uploadAttachment } from "../media.ts";

const relay = "wss://buzz.test";
const hash = "a".repeat(64);
const file = {
  url: `https://buzz.test/media/${hash}.bin`,
  sha256: hash,
  size: 3,
  type: "text/plain",
  filename: "한글 [자료].txt",
};

test("Blossom proofs bind exactly one blob and host with a 60-second lifetime", () => {
  const proof = mediaAuthTemplate(relay, hash, "upload");
  assert.ok(
    proof.content.trim(),
    "BUD-11 and the relay require a human-readable description",
  );
  assert.ok(validMediaAuth(proof, relay, proof.created_at));
  assert.equal(
    validMediaAuth({ ...proof, content: "" }, relay, proof.created_at),
    false,
  );
  assert.equal(
    validMediaAuth(proof, "https://other.test", proof.created_at),
    false,
  );
  assert.equal(validMediaAuth(proof, relay, proof.created_at + 61), false);
  assert.equal(
    validMediaAuth(
      { ...proof, tags: proof.tags.slice(0, 1) },
      relay,
      proof.created_at,
    ),
    false,
  );
});

test("attachment metadata uses native format and only authorizes current-community original blobs", () => {
  assert.equal(attachmentMarkdown(file), `[한글 \\[자료\\].txt](${file.url})`);
  assert.equal(attachmentName("../bad\nname.txt"), ".._bad_name.txt");
  const message = {
    content: attachmentMarkdown(file),
    tags: [attachmentTag(file)],
  };
  assert.deepEqual(messageAttachments(message, relay), [file]);
  assert.equal(messageText(message, relay), "");
  assert.equal(
    messageText({ content: "  plain text  ", tags: [] }, relay),
    "  plain text  ",
  );
  assert.ok(
    new TextEncoder().encode(attachmentName("가".repeat(180))).length <= 255,
  );
  assert.equal(attachmentName("업무 자료.txt"), "업무 자료.txt");
  for (const url of [
    `https://other.test/media/${hash}`,
    "https://buzz.test/query",
    `${file.url}?x=1`,
    `${file.url}#x`,
    `https://user:pass@buzz.test/media/${hash}`,
    file.url.replace("https:", "http:"),
    file.url.replace(".bin", ".thumb.jpg"),
  ]) {
    assert.throws(() => mediaUrl(url, relay));
    assert.deepEqual(
      messageAttachments(
        { content: url, tags: [["imeta", `url ${url}`]] },
        relay,
      ),
      [],
    );
  }
  assert.deepEqual(
    messageAttachments({ ...message, content: "attachment removed" }, relay),
    [],
  );
});

test("edited attachment metadata replaces the original without changing thread routing", () => {
  const original = {
    id: "root",
    pubkey: "alice",
    kind: 9,
    created_at: 1,
    content: attachmentMarkdown(file),
    tags: [["h", "general"], attachmentTag(file)],
  };
  const replacement = { ...file, filename: "renamed.txt" };
  const edit = {
    id: "edit",
    pubkey: "alice",
    kind: 40003,
    created_at: 2,
    content: attachmentMarkdown(replacement),
    tags: [["h", "general"], ["e", "root"], attachmentTag(replacement)],
  };
  assert.deepEqual(
    messageAttachments(timeline([original, edit], "general")[0], relay),
    [replacement],
  );
  assert.deepEqual(
    messageAttachments(
      timeline(
        [
          original,
          { ...edit, tags: edit.tags.slice(0, 2), content: "removed" },
        ],
        "general",
      )[0],
      relay,
    ),
    [],
  );
});

test("oversized download streams and dishonest upload descriptors fail on the production fetch path", async (t) => {
  const signer = { pubkey: "a", sign: async (template) => template };
  const large = { ...file, size: undefined };
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  });
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(stream, {
        headers: { "Content-Length": String(101 * 1024 * 1024) },
      }),
  );
  await assert.rejects(
    downloadAttachment(large, signer, relay, new AbortController().signal),
    /file-too-large/,
  );
  assert.ok(cancelled);
  globalThis.fetch.mock.mockImplementation(async () =>
    Response.json({ ...file, type: "text/plain", size: 3 }),
  );
  await assert.rejects(
    uploadAttachment(
      new File(["abc"], "test.txt"),
      signer,
      relay,
      new AbortController().signal,
    ),
    /invalid-media/,
  );
});
