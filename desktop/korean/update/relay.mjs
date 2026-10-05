import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { encrypt, decrypt } from "nostr-tools/nip49";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { createLoginService } from "../web/login-service/server.mjs";
import { hotp } from "../web/login-service/mfa.mjs";
import { RelayBridge } from "../web/login-service/relay.mjs";
import { Relay } from "../web/relay.ts";
import { relayFixture } from "./relay-fixture.mjs";

// Relay fixtures own Docker resources as well as processes. Give cancellation a
// bounded cleanup path before the outer supervisor escalates to SIGKILL.
let interrupted = false;
const interrupt = async () => {
  if (interrupted) return;
  interrupted = true;
  try {
    for (const socket of sockets) socket.dispose();
    if (service) await service.close();
    await fixture.close();
    process.exit(130);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
};
const fixture = await relayFixture();
const { origin, ownerKey, directory } = fixture;
const owner = getPublicKey(ownerKey);
const password = "synthetic owner password 123!";
const temporary = "synthetic employee temporary 123!";
const permanent = "synthetic employee permanent 123!";
const bridge = new RelayBridge(origin);
const sockets = [];
let service;
let base;
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const template = (kind, tags, content = "") => ({
  kind,
  tags,
  content,
  created_at: Math.floor(Date.now() / 1000),
});
async function startLogin() {
  service = await createLoginService({
    origin,
    owner,
    directory: path.join(directory, "accounts"),
    testing: true,
    disableJobs: true,
  });
  await new Promise((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  base = `http://127.0.0.1:${service.server.address().port}/chat-api/`;
}
async function api(route, data, cookie = "", extra = {}) {
  const result = await fetch(base + route, {
    method: data ? "POST" : "GET",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
      ...extra,
    },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(40_000),
  });
  return {
    status: result.status,
    value: await result.json(),
    cookie: result.headers.get("set-cookie")?.split(";")[0],
  };
}
async function connect(account, cookie) {
  const signer = {
    pubkey: account,
    dispose() {},
    async sign(event) {
      const result = await api("sign", { template: event }, cookie);
      assert.equal(result.status, 200);
      return result.value;
    },
  };
  const relay = new Relay(origin.replace("http:", "ws:"), signer, () => {});
  sockets.push(relay);
  await relay.ready;
  return relay;
}
try {
  await startLogin();
  const setup = await api("setup", {
    username: "admin",
    name: "합성 관리자",
    password,
    backup: encrypt(ownerKey, password, 10),
    backupPassword: password,
  });
  assert.equal(setup.status, 200);
  assert.ok(setup.value.mfaEnrollment);
  assert.equal(
    (await api("admin/accounts", undefined, setup.cookie)).status,
    401,
  );
  const encoded = setup.value.mfaEnrollment.secret;
  const bits = [...encoded]
    .map((letter) =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        .indexOf(letter)
        .toString(2)
        .padStart(5, "0"),
    )
    .join("");
  const secret = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)),
  );
  const admin = await api("login", {
    username: "admin",
    password,
    mfaChallenge: setup.value.mfaEnrollment.challenge,
    recoverySaved: true,
    mfaCode: hotp(secret, Math.floor(Date.now() / 30000)),
  });
  secret.fill(0);
  assert.equal(admin.status, 200);
  assert.ok(admin.cookie);
  const channel = randomUUID();
  const privateChannel = randomUUID();
  for (const [id, name] of [
    [channel, "synthetic-general"],
    [privateChannel, "synthetic-private"],
  ]) {
    await bridge.publish(
      ownerKey,
      finalizeEvent(
        template(9007, [
          ["h", id],
          ["name", name],
          ["visibility", "private"],
          ["channel_type", "stream"],
        ]),
        ownerKey,
      ),
    );
  }
  const historical = finalizeEvent(
    template(9, [["h", channel]], "합성 과거 대화"),
    ownerKey,
  );
  await bridge.publish(ownerKey, historical);
  const listed = await api("admin/channels", undefined, admin.cookie);
  assert.equal(listed.status, 200);
  assert.ok(
    listed.value.some((item) => item.id === channel),
    "real 39002 d-tag membership must reach production login service",
  );
  const issued = await api(
    "admin/create",
    {
      username: "staff@fixture.invalid",
      name: "합성 직원",
      password: temporary,
      channels: [channel],
    },
    admin.cookie,
  );
  assert.equal(issued.status, 201);
  for (let i = 0; i < 4; i++) await service.runJobs();
  const accounts = await api("admin/accounts", undefined, admin.cookie);
  assert.equal(
    accounts.value.find((item) => item.pubkey === issued.value.pubkey)?.status,
    "ready",
    "9030/9000/profile provisioning must be accepted by the real relay",
  );
  const staff = await api("login", {
    username: "staff@fixture.invalid",
    password: temporary,
  });
  assert.equal(staff.status, 200);
  const pubkey = staff.value.pubkey;
  assert.equal(pubkey, issued.value.pubkey);
  assert.equal(
    (await api("admin/accounts", undefined, staff.cookie)).status,
    403,
  );
  assert.equal(
    (
      await api(
        "admin/create",
        {
          username: "forbidden",
          name: "forbidden",
          password: temporary,
          channels: [],
        },
        staff.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        "password",
        { currentPassword: temporary, password: permanent },
        staff.cookie,
      )
    ).status,
    200,
  );
  const relay = await connect(pubkey, staff.cookie);
  assert.ok(
    (await relay.query({ kinds: [9], "#h": [channel], limit: 200 })).some(
      (event) => event.id === historical.id,
    ),
  );
  const message = await relay.prepare(
    template(9, [["h", channel]], "합성 한글 메시지"),
  );
  await relay.deliver(message);
  assert.ok(
    (
      await bridge.query(ownerKey, { kinds: [9], "#h": [channel], limit: 200 })
    ).some((event) => event.id === message.id),
  );
  const forbidden = await relay.prepare(
    template(9, [["h", privateChannel]], "must be rejected"),
  );
  await assert.rejects(relay.deliver(forbidden));
  await assert.rejects(
    bridge.publish(ownerKey, { ...historical, content: "invalid signature" }),
  );
  relay.dispose();
  await service.close();
  await startLogin();
  assert.equal(
    (await api("session", undefined, staff.cookie)).value.pubkey,
    pubkey,
  );
  const again = await api("login", {
    username: "staff@fixture.invalid",
    password: permanent,
  });
  assert.equal(again.value.pubkey, pubkey);
  const reopened = await connect(pubkey, again.cookie);
  assert.ok(
    (await reopened.query({ kinds: [9], "#h": [channel], limit: 200 })).some(
      (event) => event.id === historical.id,
    ),
  );
  // Expire only our disposable service's sessions, through its real durable store.
  service.store.transaction((state) => {
    for (const session of Object.values(state.sessions)) session.until = 0;
  });
  assert.equal((await api("session", undefined, again.cookie)).status, 401);
  assert.equal(
    (
      await api(
        "sign",
        { template: template(9, [["h", channel]], "expired") },
        again.cookie,
      )
    ).status,
    401,
  );
  const recovered = await api("login", {
    username: "staff@fixture.invalid",
    password: permanent,
  });
  assert.equal(recovered.value.pubkey, pubkey);
  const native = await api(
    "desktop/login",
    { username: "staff@fixture.invalid", password: permanent },
    "",
    { Origin: "tauri://localhost" },
  );
  assert.equal(native.status, 200);
  const key = decrypt(native.value.backup, permanent);
  assert.equal(getPublicKey(key), pubkey);
  key.fill(0);
  console.log(
    "Real relay passed: NIP-98, NIP-42, provisioning, employee/admin boundaries, history, restart identity, expired-session recovery, native encrypted enrollment, invalid-signature rejection.",
  );
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  for (const socket of sockets) socket.dispose();
  if (service) await service.close();
  await fixture.close();
}
