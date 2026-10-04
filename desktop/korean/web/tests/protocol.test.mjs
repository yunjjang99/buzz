import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { encrypt } from "nostr-tools/nip49";
import { JSDOM } from "jsdom";
import {
  memberChannels,
  messageTemplate,
  retainEvent,
  timeline,
  validateBackup,
} from "../protocol.ts";
import { acknowledgeOutbox, readOutbox, saveOutbox } from "../outbox.ts";
import { checkedEvent } from "../signer.ts";
import { readAccount, saveAccount, forgetAccount } from "../account.ts";
import { Relay } from "../relay.ts";

const key = new Uint8Array(32).fill(1);
const otherKey = new Uint8Array(32).fill(2);
const pubkey = getPublicKey(key);
const makeEvent = (kind, tags, content = "", created_at = 100, secret = key) =>
  finalizeEvent({ kind, tags, content, created_at }, secret);
const originalSocket = globalThis.WebSocket;
const originalStorage = globalThis.sessionStorage;
const originalLocalStorage = globalThis.localStorage;
afterEach(() => {
  globalThis.WebSocket = originalSocket;
  globalThis.sessionStorage = originalStorage;
  globalThis.localStorage = originalLocalStorage;
});

test("membership metadata uses d tags and resolves newer removals", () => {
  const memberships = [
    makeEvent(39002, [
      ["d", "general"],
      ["p", pubkey],
    ]),
    makeEvent(39002, [
      ["d", "private"],
      ["p", pubkey],
    ]),
    makeEvent(39002, [["d", "private"]], "", 101),
  ];
  const metadata = [
    makeEvent(39000, [
      ["d", "general"],
      ["name", "일반"],
    ]),
    makeEvent(39000, [
      ["d", "private"],
      ["name", "숨김"],
    ]),
  ];
  assert.deepEqual(
    memberChannels(memberships, metadata, pubkey).map(
      (channel) => channel.name,
    ),
    ["일반"],
  );
});

test("channel scoping, author-owned edits and deletion remain authoritative", () => {
  const root = makeEvent(9, [["h", "general"]], "원본");
  const edit = makeEvent(
    40003,
    [
      ["h", "general"],
      ["e", root.id],
    ],
    "수정",
    101,
  );
  const forged = makeEvent(
    40003,
    [
      ["h", "general"],
      ["e", root.id],
    ],
    "위조",
    102,
    otherKey,
  );
  const other = makeEvent(9, [["h", "private"]], "다른 채널");
  assert.equal(
    timeline([root, edit, forged, other], "general")[0].content,
    "수정",
  );
  const deletion = makeEvent(
    5,
    [
      ["h", "general"],
      ["e", root.id],
    ],
    "",
    103,
  );
  assert.equal(timeline([root, edit, deletion], "general")[0].deleted, true);
});

test("reply construction preserves raw user text and binds the original channel", () => {
  const root = makeEvent(9, [["h", "general"]], "첫 메시지");
  const reply = messageTemplate("general", "  한글 {name}  ", root);
  assert.equal(reply.content, "한글 {name}");
  assert.deepEqual(reply.tags[1], ["e", root.id, "", "reply"]);
  assert.throws(
    () => messageTemplate("private", "wrong", root),
    /wrong-channel/,
  );
  assert.throws(
    () => messageTemplate("general", `nsec1${"a".repeat(30)}`),
    /key-in-message/,
  );
  assert.equal(retainEvent([root], root).length, 1);
});

test("untrusted NIP-49 allocation is bounded before decryption", () => {
  const backup = encrypt(key, "temporary fixture password", 1);
  assert.equal(validateBackup(backup), backup);
  assert.equal(validateBackup(backup.toUpperCase()), backup);
  assert.throws(() => validateBackup("nsec1test"), /encrypted-backup-required/);
  assert.throws(
    () => validateBackup(`ncryptsec1${"q".repeat(500)}`),
    /invalid-backup/,
  );
  const words = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  // Encode version 2 + log_n 31 into the first four five-bit words.
  const packed = (2 << 12) | (31 << 4);
  const prefix = [15, 10, 5, 0]
    .map((shift) => words[(packed >> shift) & 31])
    .join("");
  assert.throws(
    () => validateBackup(backup.slice(0, 10) + prefix + backup.slice(14)),
    /unsupported-backup/,
  );
});

test("worker/provider output must preserve the exact approved identity and event", () => {
  const template = messageTemplate("general", "approved");
  const event = finalizeEvent(template, key);
  assert.equal(checkedEvent(template, event, pubkey).id, event.id);
  assert.throws(
    () =>
      checkedEvent(
        template,
        finalizeEvent({ ...template, content: "changed" }, key),
        pubkey,
      ),
    /invalid-signature/,
  );
  assert.throws(
    () => checkedEvent(template, finalizeEvent(template, otherKey), pubkey),
    /invalid-signature/,
  );
});

test("retry journal persists before send and clears only the acknowledged event", () => {
  globalThis.sessionStorage = new JSDOM("", {
    url: "https://buzz.kovar.kr/chat/",
  }).window.sessionStorage;
  const event = makeEvent(9, [["h", "general"]], "retry");
  saveOutbox("wss://buzz.kovar.kr", event);
  assert.equal(readOutbox("wss://buzz.kovar.kr", pubkey).id, event.id);
  assert.equal(readOutbox("wss://another.invalid", pubkey), null);
  assert.equal(readOutbox("wss://buzz.kovar.kr", getPublicKey(otherKey)), null);
  acknowledgeOutbox("different-id");
  assert.equal(readOutbox("wss://buzz.kovar.kr", pubkey).id, event.id);
  acknowledgeOutbox(event.id);
  assert.equal(readOutbox("wss://buzz.kovar.kr", pubkey), null);
});

class FakeSocket {
  static OPEN = 1;
  static latest;
  readyState = 1;
  frames = [];
  constructor() {
    FakeSocket.latest = this;
  }
  send(value) {
    this.frames.push(JSON.parse(value));
  }
  close() {
    this.readyState = 3;
  }
  receive(frame) {
    this.onmessage({ data: JSON.stringify(frame) });
  }
}
async function connection() {
  globalThis.WebSocket = FakeSocket;
  const signer = {
    pubkey,
    sign: async (template) => finalizeEvent(template, key),
    dispose() {},
  };
  const relay = new Relay("wss://buzz.kovar.kr", signer, () => {});
  const socket = FakeSocket.latest;
  socket.receive(["AUTH", "fixture-challenge"]);
  await Promise.resolve();
  await Promise.resolve();
  const auth = socket.frames.find((frame) => frame[0] === "AUTH");
  socket.receive(["OK", auth[1].id, true, ""]);
  await relay.ready;
  return { relay, socket };
}

test("production connection authenticates before REQ and keeps live subscription after EOSE", async () => {
  const { relay, socket } = await connection();
  assert.equal(
    socket.frames.some((frame) => frame[0] === "REQ"),
    false,
  );
  const received = [];
  const cancel = relay.subscribe(
    { kinds: [9], "#h": ["general"], limit: 200 },
    (event) => received.push(event),
    () => {},
    assert.fail,
  );
  const id = socket.frames.find((frame) => frame[0] === "REQ")[1];
  const event = makeEvent(9, [["h", "general"]], "history");
  socket.receive(["EVENT", id, event]);
  socket.receive(["EOSE", id]);
  socket.receive(["EVENT", id, makeEvent(9, [["h", "general"]], "live", 101)]);
  assert.equal(received.length, 2);
  cancel();
  relay.dispose();
});

test("negative publish OK propagates and retry sends the exact same event ID", async () => {
  const { relay, socket } = await connection();
  const event = await relay.prepare(messageTemplate("general", "안녕하세요"));
  const rejected = relay.deliver(event);
  const rejection = assert.rejects(rejected, /permission denied/);
  socket.receive(["OK", event.id, false, "permission denied"]);
  await rejection;
  const retry = relay.deliver(event);
  socket.receive(["OK", event.id, true, ""]);
  await retry;
  assert.deepEqual(
    socket.frames
      .filter((frame) => frame[0] === "EVENT")
      .map((frame) => frame[1].id),
    [event.id, event.id],
  );
  relay.dispose();
});

test("unexpected socket close rejects finite history rather than returning an empty success", async () => {
  const { relay, socket } = await connection();
  const result = relay.query({ kinds: [39002], "#p": [pubkey], limit: 1000 });
  const rejected = assert.rejects(result, /connection-closed/);
  socket.onclose();
  await rejected;
});

test("device account persists only encrypted identity atomically and preserves recovery", () => {
  const dom = new JSDOM("", { url: "https://buzz.kovar.kr/chat/" });
  globalThis.localStorage = dom.window.localStorage;
  const password = "synthetic test password";
  const backup = encrypt(key, password, 10);
  const relay = "wss://buzz.kovar.kr";
  assert.equal(readAccount(relay), null);
  const expected = saveAccount(relay, pubkey, backup);
  assert.deepEqual(readAccount(relay), expected);
  const raw = localStorage.getItem("buzz-korean-web.account.v1");
  assert.ok(!raw.includes(password));
  assert.ok(!raw.includes(Buffer.from(key).toString("hex")));
  assert.throws(
    () => readAccount("wss://other.example"),
    /saved-account-invalid/,
  );
  assert.throws(() => saveAccount(relay, pubkey, "plaintext secret"));
  assert.deepEqual(readAccount(relay), expected);
  globalThis.localStorage = {
    setItem() {
      throw new Error("quota-exceeded");
    },
  };
  assert.throws(() => saveAccount(relay, pubkey, backup), /quota-exceeded/);
  globalThis.localStorage = dom.window.localStorage;
  localStorage.setItem("buzz-korean-web.account.v1", "corrupt");
  assert.throws(() => readAccount(relay), /saved-account-invalid/);
  forgetAccount();
  assert.equal(readAccount(relay), null);
});
