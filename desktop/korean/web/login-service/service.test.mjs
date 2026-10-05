import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { encrypt, decrypt } from "nostr-tools/nip49";
import { getPublicKey, finalizeEvent, verifyEvent } from "nostr-tools/pure";
const { createLoginService } = await import(
  process.env.BUZZ_LOGIN_TEST_BUILD
    ? "../../login-dist/server.mjs"
    : "./server.mjs"
);
import { hotp } from "./mfa.mjs";
import { Store, Limiter } from "./store.mjs";
import { RelayBridge } from "./relay.mjs";
const secret = new Uint8Array(32).fill(1);
const staffKey = new Uint8Array(32).fill(2);
const owner = getPublicKey(secret);
const origin = "https://buzz.test";
const temporary = "temporary fixture password";
const permanent = "permanent fixture password";
const backup = encrypt(
  secret,
  temporary,
  process.env.BUZZ_LOGIN_TEST_BUILD ? 18 : 10,
);
const metadata = finalizeEvent(
  {
    kind: 39000,
    created_at: 1,
    tags: [
      ["d", "general"],
      ["name", "일반"],
      ["t", "stream"],
    ],
    content: "",
  },
  secret,
);
const membership = finalizeEvent(
  {
    kind: 39002,
    created_at: 1,
    tags: [
      ["d", "general"],
      ["p", owner],
    ],
    content: "",
  },
  secret,
);
async function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "buzz-login-test-"));
  const published = [];
  let reject = false;
  const bridge = {
    query: async (_key, filter) =>
      filter.kinds[0] === 39002 ? [membership] : [metadata],
    publish: async (_key, event) => {
      assert.ok(verifyEvent(event));
      if (reject) throw new Error("synthetic-rejection");
      published.push(event);
    },
  };
  const configuration = {
    origin,
    owner,
    directory,
    bridge,
    disableJobs: true,
    ...options,
  };
  let service = await createLoginService(configuration);
  await new Promise((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  let base = `http://127.0.0.1:${service.server.address().port}/chat-api/`;
  async function rawApi(route, data, cookie = "", extra = {}) {
    const result = await fetch(base + route, {
      method: data ? "POST" : "GET",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie,
        ...extra,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return {
      status: result.status,
      value: await result.json(),
      cookie: result.headers.get("set-cookie")?.split(";")[0],
      cookieHeader: result.headers.get("set-cookie"),
      retryAfter: result.headers.get("retry-after"),
    };
  }
  let recoveryCodes = [];
  async function api(route, data, cookie = "", extra = {}) {
    let injected = false;
    if (
      !options.manualMfa &&
      ["login", "desktop/login"].includes(route) &&
      data.username.toLowerCase() === "admin" &&
      data.password === permanent &&
      !data.mfaCode &&
      recoveryCodes.length
    ) {
      data = { ...data, mfaCode: recoveryCodes[0] };
      injected = true;
    }
    let result = await rawApi(route, data, cookie, extra);
    if (!options.manualMfa && route === "setup" && result.value.mfaEnrollment) {
      recoveryCodes = result.value.mfaEnrollment.recoveryCodes;
      const account = service.store.state.accounts.admin;
      const secret = service.store.open({
        key: account.mfaEnrollment.secret,
        pubkey: `mfa:${account.pubkey}`,
      });
      result = await rawApi("login", {
        username: "admin",
        password: permanent,
        mfaChallenge: result.value.mfaEnrollment.challenge,
        recoverySaved: true,
        mfaCode: hotp(
          secret,
          Math.floor((options.clock?.() ?? Date.now()) / 30000),
        ),
      });
      secret.fill(0);
    }
    if (injected && result.status === 200) recoveryCodes.shift();
    return result;
  }
  return {
    rawApi,
    get service() {
      return service;
    },
    restart: async () => {
      await service.close();
      service = await createLoginService(configuration);
      await new Promise((resolve) =>
        service.server.listen(0, "127.0.0.1", resolve),
      );
      base = `http://127.0.0.1:${service.server.address().port}/chat-api/`;
    },
    directory,
    published,
    api,
    setup: () =>
      api("setup", {
        username: "admin",
        name: "관리자",
        password: permanent,
        backup,
        backupPassword: temporary,
      }),
    finish: async () => {
      await service.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
    reject: (value) => {
      reject = value;
    },
  };
}

test("owner migration, employee issue, password changes and reset retain one identity", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.api("status")).value.configured, false);
    const wrong = await f.api("setup", {
      username: "admin",
      name: "관리자",
      password: permanent,
      backup: encrypt(staffKey, temporary, 10),
      backupPassword: temporary,
    });
    assert.equal(wrong.status, 403);
    assert.equal(Object.keys(f.service.store.state.accounts).length, 0);
    const admin = await f.setup();
    assert.equal(admin.status, 200);
    assert.equal(admin.value.pubkey, owner);
    assert.match(admin.cookieHeader, /HttpOnly; Secure; SameSite=Strict/);
    assert.equal((await f.api("setup", {})).status, 409);
    const privateData = fs.readFileSync(
      path.join(f.directory, "accounts.json"),
      "utf8",
    );
    for (const value of [
      temporary,
      permanent,
      Buffer.from(secret).toString("hex"),
    ])
      assert.ok(!privateData.includes(value));
    assert.equal(admin.value.hash, undefined);
    assert.equal(admin.value.key, undefined);
    assert.equal((await f.api("admin/accounts")).status, 401);
    const created = await f.api(
      "admin/create",
      {
        username: "staff01",
        name: "직원",
        password: temporary,
        channels: ["general"],
      },
      admin.cookie,
    );
    assert.equal(created.status, 201);
    assert.equal(created.value.status, "pending");
    const stable = created.value.pubkey;
    assert.equal(
      (await f.api("login", { username: "staff01", password: temporary }))
        .status,
      409,
    );
    for (let step = 0; step < 3; step++) await f.service.runJobs();
    assert.deepEqual(
      f.published.map((event) => event.kind),
      [9030, 9000, 0],
    );
    assert.equal(f.service.store.state.accounts.staff01.job.status, "ready");
    const member = await f.api("login", {
      username: "STAFF01",
      password: temporary,
      remember: true,
    });
    assert.equal(member.status, 200);
    assert.equal(member.value.pubkey, stable);
    assert.match(member.cookieHeader, /Max-Age=2592000/);
    assert.equal(
      (await f.api("session", undefined, member.cookie)).value.pubkey,
      stable,
    );
    const auth = {
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [
        ["relay", "wss://buzz.test"],
        ["challenge", "fixture-challenge"],
      ],
    };
    assert.ok(
      verifyEvent(
        (await f.api("sign", { template: auth }, member.cookie)).value,
      ),
    );
    const message = {
      kind: 9,
      created_at: auth.created_at,
      content: "이전 대화를 이어갑니다",
      tags: [["h", "general"]],
    };
    assert.equal(
      (await f.api("sign", { template: message }, member.cookie)).status,
      403,
    );
    assert.equal(
      (await f.api("admin/accounts", undefined, member.cookie)).status,
      403,
    );
    assert.equal(
      (
        await f.api(
          "password",
          { currentPassword: temporary, password: permanent },
          member.cookie,
        )
      ).status,
      200,
    );
    const signedMessage = await f.api(
      "sign",
      { template: message },
      member.cookie,
    );
    assert.ok(verifyEvent(signedMessage.value));
    assert.equal(signedMessage.value.pubkey, stable);
    assert.equal(
      (
        await f.api(
          "sign",
          {
            template: {
              ...auth,
              tags: [
                ["relay", "wss://attacker.test"],
                ["challenge", "x"],
              ],
            },
          },
          member.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.api(
          "sign",
          { template: { ...message, kind: 9030 } },
          member.cookie,
        )
      ).status,
      403,
    );
    for (let attempt = 0; attempt < 5; attempt++)
      await f.api("login", {
        username: "staff01",
        password: "incorrect password",
      });
    assert.equal(
      (await f.api("login", { username: "staff01", password: permanent })).value
        .error,
      "login-locked",
    );
    assert.equal(
      (
        await f.api(
          "admin/reset",
          { username: "staff01", password: "another fixture password" },
          admin.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await f.api("session", undefined, member.cookie)).status,
      401,
    );
    const afterReset = await f.api("login", {
      username: "staff01",
      password: "another fixture password",
    });
    assert.equal(afterReset.value.pubkey, stable);
    assert.equal(afterReset.value.mustChangePassword, true);
    assert.equal(
      (await f.api("login", { username: "staff01", password: permanent }))
        .status,
      401,
    );
    assert.equal(
      (
        await f.api("logout", {}, afterReset.cookie, {
          Origin: "https://attacker.test",
        })
      ).status,
      403,
    );
    assert.equal((await f.api("logout", {}, afterReset.cookie)).status, 200);
    assert.equal(
      (await f.api("session", undefined, afterReset.cookie)).status,
      401,
    );
    const reopened = new Store(f.directory);
    assert.equal(reopened.state.accounts.staff01.pubkey, stable);
    assert.deepEqual(
      reopened.open(reopened.state.accounts.admin),
      Buffer.from(secret),
    );
  } finally {
    await f.finish();
  }
});

test("failed provisioning survives restart and retries the same signed events", async () => {
  const f = await fixture();
  try {
    const admin = await f.setup();
    const created = await f.api(
      "admin/create",
      {
        username: "existing",
        name: "기존 직원",
        password: temporary,
        backup: encrypt(staffKey, temporary, 10),
        backupPassword: temporary,
        channels: ["general"],
      },
      admin.cookie,
    );
    assert.equal(created.value.pubkey, getPublicKey(staffKey));
    const original = f.service.store.state.accounts.existing.job.steps.map(
      (step) => step.event.id,
    );
    f.reject(true);
    for (let attempt = 0; attempt < 6; attempt++) {
      f.service.store.transaction((state) => {
        state.accounts.existing.job.nextAt = 0;
      });
      await f.service.runJobs();
    }
    assert.equal(
      new Store(f.directory).state.accounts.existing.job.status,
      "failed",
    );
    assert.equal(f.service.store.state.accounts.existing.job.index, 0);
    assert.equal(
      (await f.api("admin/retry", { username: "existing" }, admin.cookie))
        .status,
      200,
    );
    f.reject(false);
    for (let step = 0; step < 2; step++) await f.service.runJobs();
    assert.equal(f.service.store.state.accounts.existing.job.status, "ready");
    assert.deepEqual(
      f.published.map((event) => event.id),
      original,
    );
    assert.deepEqual(
      f.published.map((event) => event.kind),
      [9030, 9000],
    );
  } finally {
    await f.finish();
  }
});

test("durable failures do not publish memory; encrypted identities bind their public key", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "buzz-login-write-"));
  try {
    const store = new Store(directory);
    store.transaction((state) => {
      state.accounts.valid = { username: "valid" };
    });
    const saved = store.state;
    fs.unlinkSync(store.file);
    fs.mkdirSync(store.file);
    assert.throws(() =>
      store.transaction((state) => {
        state.accounts.invalid = {};
      }),
    );
    assert.equal(store.state, saved);
    assert.equal(store.state.accounts.invalid, undefined);
    assert.throws(() =>
      store.open({
        key: store.seal(secret, owner),
        pubkey: getPublicKey(staffKey),
      }),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("credential retries and limiter storage are bounded", async () => {
  const f = await fixture();
  try {
    for (let attempt = 0; attempt < 4; attempt++)
      assert.equal(
        (await f.api("login", { username: "unknown", password: temporary }))
          .status,
        401,
      );
    assert.equal(
      (await f.api("login", { username: "unknown", password: temporary }))
        .status,
      429,
    );
    const limiter = new Limiter();
    for (let index = 0; index < 2048; index++)
      limiter.take(String(index), 1, 60000);
    assert.throws(() => limiter.take("overflow", 1, 60000), /rate-limited/);
    assert.equal(limiter.records.size, 2048);
  } finally {
    await f.finish();
  }
});

test("HTTP bridge binds host, payload and fresh NIP-98 proof on every retry", async () => {
  const ids = [];
  const server = http.createServer(async (request, response) => {
    const pieces = [];
    for await (const piece of request) pieces.push(piece);
    const body = Buffer.concat(pieces).toString();
    const auth = JSON.parse(
      Buffer.from(request.headers.authorization.slice(6), "base64").toString(),
    );
    assert.ok(verifyEvent(auth));
    assert.equal(request.headers.host, "buzz.test");
    assert.deepEqual(
      auth.tags.find((tag) => tag[0] === "u"),
      ["u", `${origin}${request.url}`],
    );
    assert.deepEqual(
      auth.tags.find((tag) => tag[0] === "payload"),
      ["payload", createHash("sha256").update(body).digest("hex")],
    );
    ids.push(auth.id);
    const input = JSON.parse(body);
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/query") {
      assert.ok(Array.isArray(input));
      assert.deepEqual(input[0].kinds, [39000]);
      response.end(JSON.stringify([metadata]));
    } else response.end(JSON.stringify({ event_id: input.id, accepted: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const bridge = new RelayBridge(
      origin,
      `http://127.0.0.1:${server.address().port}`,
    );
    await bridge.query(secret, { kinds: [39000], limit: 1 });
    await bridge.publish(secret, metadata);
    await bridge.publish(secret, metadata);
    assert.equal(new Set(ids).size, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("native login exports only a password-encrypted identity and isolates bearer sessions", async () => {
  const f = await fixture();
  const headers = { Origin: "tauri://localhost" };
  try {
    await f.setup();
    const denied = await f.api("desktop/login", {
      username: "admin",
      password: permanent,
    });
    assert.equal(denied.status, 403);
    const login = await f.api(
      "desktop/login",
      { username: "admin", password: permanent },
      "",
      headers,
    );
    assert.equal(login.status, 200);
    assert.equal(getPublicKey(decrypt(login.value.backup, permanent)), owner);
    assert.ok(
      !JSON.stringify(login.value).includes(
        Buffer.from(secret).toString("hex"),
      ),
    );
    assert.equal(
      (
        await f.api("session", undefined, "", {
          ...headers,
          Authorization: `Bearer ${login.value.token}`,
        })
      ).value.pubkey,
      owner,
    );
    assert.equal((await f.api("session", undefined, login.cookie)).status, 401);
    const web = await f.api("login", {
      username: "admin",
      password: permanent,
    });
    assert.equal(
      (
        await f.api("session", undefined, "", {
          ...headers,
          Authorization: `Bearer ${web.cookie.split("=")[1]}`,
        })
      ).status,
      401,
    );
    const create = await f.api(
      "admin/create",
      {
        username: "staff",
        name: "직원",
        password: temporary,
        channels: ["general"],
      },
      web.cookie,
    );
    assert.equal(create.status, 201);
    await f.service.runJobs();
    await f.service.runJobs();
    await f.service.runJobs();
    const initial = await f.api(
      "desktop/login",
      { username: "staff", password: temporary },
      "",
      headers,
    );
    assert.equal(initial.status, 409);
    assert.equal(initial.value.error, "password-change-required");
    const changed = await f.api(
      "desktop/login",
      { username: "staff", password: temporary, newPassword: permanent },
      "",
      headers,
    );
    assert.equal(changed.status, 200);
    assert.equal(
      getPublicKey(decrypt(changed.value.backup, permanent)),
      changed.value.account.pubkey,
    );
    assert.equal(changed.value.account.mustChangePassword, false);
    await f.api("logout", {}, "", {
      ...headers,
      Authorization: `Bearer ${login.value.token}`,
    });
    assert.equal(
      (
        await f.api("session", undefined, "", {
          ...headers,
          Authorization: `Bearer ${login.value.token}`,
        })
      ).status,
      401,
    );
  } finally {
    await f.finish();
  }
});

test("email IDs provision and sign in case-insensitively without aliasing malformed IDs", async () => {
  const f = await fixture();
  try {
    const admin = await f.setup();
    for (const id of ["shin4895@gmail.com", "cbtcshin@naver.com"]) {
      const issued = await f.api(
        "admin/create",
        { username: id, name: "직원", password: temporary, channels: [] },
        admin.cookie,
      );
      assert.equal(issued.status, 201);
      for (let step = 0; step < 3; step++) await f.service.runJobs();
      const login = await f.api("login", {
        username: id.toUpperCase(),
        password: temporary,
      });
      assert.equal(login.status, 200);
      assert.equal(login.value.username, id);
      assert.equal(login.value.pubkey, issued.value.pubkey);
      const duplicate = await f.api(
        "admin/create",
        {
          username: id.toUpperCase(),
          name: "중복",
          password: temporary,
          channels: [],
        },
        admin.cookie,
      );
      assert.equal(duplicate.status, 409);
    }
    for (const id of [
      "a@@b.com",
      "a@b",
      "a..b@example.com",
      "a.@example.com",
      "a@-bad.com",
      "a@b.com\n",
      `${"a".repeat(65)}@example.com`,
    ]) {
      const result = await f.api(
        "admin/create",
        { username: id, name: "직원", password: temporary, channels: [] },
        admin.cookie,
      );
      assert.equal(result.value.error, "invalid-username", id);
    }
  } finally {
    await f.finish();
  }
});

test("file signing is session-bound, hash-scoped, short-lived and limited to upload/get", async () => {
  const f = await fixture();
  try {
    const admin = await f.setup();
    const created_at = Math.floor(Date.now() / 1000);
    const template = {
      kind: 24242,
      created_at,
      content: "Buzz file transfer",
      tags: [
        ["t", "upload"],
        ["x", "a".repeat(64)],
        ["server", "buzz.test"],
        ["expiration", String(created_at + 60)],
      ],
    };
    assert.equal((await f.api("sign", { template })).status, 401);
    for (const verb of ["upload", "get"]) {
      const proof = structuredClone(template);
      proof.tags[0][1] = verb;
      const result = await f.api("sign", { template: proof }, admin.cookie);
      assert.equal(result.status, 200);
      assert.equal(result.value.pubkey, owner);
      assert.ok(verifyEvent(result.value));
      assert.deepEqual(result.value.tags, proof.tags);
    }
    const invalid = [
      { ...template, content: "" },
      { ...template, content: "not an auth proof" },
      { ...template, tags: template.tags.slice(0, 3) },
      { ...template, tags: [...template.tags, ["x", "b".repeat(64)]] },
    ];
    for (const [index, value] of [
      [0, "delete"],
      [1, "not-a-hash"],
      [2, "foreign.test"],
      [3, String(created_at + 3600)],
      [3, String(created_at - 1)],
    ]) {
      const proof = structuredClone(template);
      proof.tags[index][1] = value;
      invalid.push(proof);
    }
    for (const proof of invalid)
      assert.equal(
        (await f.api("sign", { template: proof }, admin.cookie)).status,
        403,
      );
    const message = {
      kind: 9,
      created_at,
      content: `[file](https://buzz.test/media/${"a".repeat(64)}.bin)`,
      tags: [
        ["h", "general"],
        [
          "imeta",
          `url https://buzz.test/media/${"a".repeat(64)}.bin`,
          "m application/octet-stream",
          `x ${"a".repeat(64)}`,
          "size 3",
          "filename 업무 자료.txt",
        ],
      ],
    };
    assert.equal(
      (await f.api("sign", { template: message }, admin.cookie)).status,
      200,
    );
    f.service.store.transaction((state) => {
      state.accounts.admin.mustChangePassword = true;
    });
    assert.equal((await f.api("sign", { template }, admin.cookie)).status, 403);
  } finally {
    await f.finish();
  }
});

test("login lock escalation is durable, shared across clients and does not slide", async () => {
  let time = Date.now();
  const f = await fixture({ clock: () => time });
  try {
    assert.equal((await f.setup()).status, 200);
    const attempt = (password = "wrong password", desktop = false) =>
      f.api(
        desktop ? "desktop/login" : "login",
        { username: "ADMIN", password },
        "",
        desktop ? { Origin: "tauri://localhost" } : {},
      );
    for (const seconds of [60, 300, 3600, 86400, 86400]) {
      for (let i = 0; i < 4; i++) assert.equal((await attempt()).status, 401);
      const locked = await attempt("wrong password", true);
      assert.equal(locked.status, 429);
      assert.equal(locked.value.error, "login-locked");
      assert.equal(locked.retryAfter, String(seconds));
      await f.restart();
      time += 1000;
      const correctButLocked = await attempt(permanent);
      assert.equal(correctButLocked.value.error, "login-locked");
      assert.equal(correctButLocked.value.retryAfter, seconds - 1);
      time += (seconds - 1) * 1000;
    }
    assert.equal((await attempt(permanent)).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).value.retryAfter, 60);
    assert.equal(f.service.store.state.loginAudit.length, 6);
  } finally {
    await f.finish();
  }
});

test("unknown accounts get the same lock responses without creating accounts", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 4; i++)
      assert.equal(
        (await f.api("login", { username: "missing", password: "wrong" }))
          .status,
        401,
      );
    const result = await f.api("login", {
      username: "missing",
      password: "wrong",
    });
    assert.equal(result.value.error, "login-locked");
    assert.equal(result.value.retryAfter, 60);
    assert.equal(Object.keys(f.service.store.state.accounts).length, 0);
  } finally {
    await f.finish();
  }
});

test("concurrent fifth failure cannot issue a session past the lock", async () => {
  const f = await fixture();
  try {
    await f.setup();
    for (let i = 0; i < 4; i++)
      await f.api("login", { username: "admin", password: "wrong" });
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.api("login", { username: "admin", password: "wrong" }),
      ),
    );
    assert.ok(results.every((result) => result.status === 429));
    assert.equal(f.service.store.state.loginAudit.length, 1);
    assert.equal(
      (await f.api("login", { username: "admin", password: permanent })).value
        .error,
      "login-locked",
    );
  } finally {
    await f.finish();
  }
});

test("failure persistence errors never become authentication success", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const original = f.service.store.transaction.bind(f.service.store);
    f.service.store.transaction = () => {
      throw new Error("synthetic-disk-failure");
    };
    const failed = await f.api("login", {
      username: "admin",
      password: "wrong",
    });
    assert.equal(failed.status, 500);
    assert.equal(failed.cookie, undefined);
    f.service.store.transaction = original;
    assert.equal(
      (await f.api("login", { username: "admin", password: "wrong" })).status,
      401,
    );
  } finally {
    await f.finish();
  }
});

function decodeMfaSecret(encoded) {
  let bits = "";
  for (const letter of encoded)
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
      .indexOf(letter)
      .toString(2)
      .padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
}
async function enrollAdmin(f, time) {
  const first = await f.setup();
  assert.equal(first.status, 200);
  assert.equal(first.cookie, undefined);
  assert.equal(first.value.token, undefined);
  assert.equal(first.value.backup, undefined);
  const challenge = first.value.mfaEnrollment;
  const secret = decodeMfaSecret(challenge.secret);
  const proof = {
    username: "admin",
    password: permanent,
    mfaChallenge: challenge.challenge,
    recoverySaved: true,
    mfaCode: hotp(secret, Math.floor(time / 30000)),
  };
  const result = await f.rawApi("login", proof);
  assert.equal(result.status, 200);
  return { ...result, challenge, secret, proof };
}

test("MFA registers through HTTP, rejects password-only login and pre-MFA sessions, persists replay fences", async () => {
  let time = Math.floor(Date.now() / 30000) * 30000;
  const f = await fixture({ manualMfa: true, clock: () => time });
  try {
    const enrolled = await enrollAdmin(f, time);
    assert.equal(enrolled.value.mfaEnabled, true);
    assert.equal(enrolled.value.recoveryCodesRemaining, 10);
    const serialized = fs.readFileSync(
      path.join(f.directory, "accounts.json"),
      "utf8",
    );
    assert.ok(!serialized.includes(enrolled.challenge.secret));
    for (const code of enrolled.challenge.recoveryCodes)
      assert.ok(!serialized.includes(code.replaceAll("-", "")));
    f.service.store.transaction((state) => {
      state.sessions[
        createHash("sha256").update("a".repeat(64)).digest("hex")
      ] = {
        username: "admin",
        until: Math.floor(Date.now() / 1000) + 300,
      };
    });
    assert.equal(
      (
        await f.rawApi(
          "session",
          undefined,
          `__Host-buzz_session=${"a".repeat(64)}`,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await f.rawApi(
          "admin/accounts",
          undefined,
          `__Host-buzz_session=${"a".repeat(64)}`,
        )
      ).status,
      401,
    );
    for (const desktop of [false, true]) {
      const result = await f.rawApi(
        desktop ? "desktop/login" : "login",
        { username: "admin", password: permanent },
        "",
        desktop ? { Origin: "tauri://localhost" } : {},
      );
      assert.equal(result.value.error, "mfa-required");
      assert.equal(result.cookie, undefined);
      assert.equal(result.value.backup, undefined);
      assert.equal(result.value.token, undefined);
    }
    assert.equal(
      (await f.rawApi("login", enrolled.proof)).value.error,
      "invalid-mfa",
    );
    time += 30000;
    const code = hotp(enrolled.secret, Math.floor(time / 30000));
    const loggedIn = await f.rawApi("login", {
      username: "admin",
      password: permanent,
      mfaCode: code,
    });
    assert.equal(loggedIn.status, 200);
    await f.restart();
    assert.equal(
      (
        await f.rawApi("login", {
          username: "admin",
          password: permanent,
          mfaCode: code,
        })
      ).value.error,
      "invalid-mfa",
    );
    const recovery = enrolled.challenge.recoveryCodes[0];
    const recovered = await f.rawApi(
      "desktop/login",
      { username: "admin", password: permanent, mfaCode: recovery },
      "",
      { Origin: "tauri://localhost" },
    );
    assert.equal(recovered.status, 200);
    assert.equal(recovered.value.account.recoveryCodesRemaining, 9);
    assert.match(recovered.value.backup, /^ncryptsec/);
    await f.restart();
    assert.equal(
      (
        await f.rawApi("login", {
          username: "admin",
          password: permanent,
          mfaCode: recovery,
        })
      ).value.error,
      "invalid-mfa",
    );
  } finally {
    await f.finish();
  }
});

test("MFA failures share durable account lockout and parallel recovery cannot be reused", async () => {
  let time = Date.now();
  const f = await fixture({ manualMfa: true, clock: () => time });
  try {
    const enrolled = await enrollAdmin(f, time);
    for (let i = 0; i < 4; i++)
      assert.equal(
        (
          await f.rawApi("login", {
            username: "admin",
            password: permanent,
            mfaCode: "bad",
          })
        ).value.error,
        "invalid-mfa",
      );
    assert.equal(
      (
        await f.rawApi("login", {
          username: "admin",
          password: permanent,
          mfaCode: "bad",
        })
      ).value.retryAfter,
      60,
    );
    await f.restart();
    const input = {
      username: "admin",
      password: permanent,
      mfaCode: enrolled.challenge.recoveryCodes[0],
    };
    assert.equal((await f.rawApi("login", input)).value.error, "login-locked");
    time += 60000;
    const results = await Promise.all([
      f.rawApi("login", input),
      f.rawApi("login", input),
    ]);
    assert.equal(results.filter((result) => result.status === 200).length, 1);
    assert.equal(f.service.store.state.accounts.admin.mfa.recovery.length, 9);
  } finally {
    await f.finish();
  }
});

test("pending enrollment expires, requires acknowledgement, and cannot bypass privileged routes", async () => {
  let time = Date.now();
  const f = await fixture({ manualMfa: true, clock: () => time });
  try {
    const started = await f.setup();
    const pending = started.value.mfaEnrollment;
    const input = {
      username: "admin",
      password: permanent,
      mfaChallenge: pending.challenge,
      mfaCode: hotp(decodeMfaSecret(pending.secret), Math.floor(time / 30000)),
    };
    assert.equal(
      (await f.rawApi("login", input)).value.error,
      "mfa-enrollment-expired",
    );
    assert.equal((await f.rawApi("admin/accounts")).status, 401);
    assert.equal((await f.rawApi("sign", { template: {} })).status, 401);
    assert.equal(Object.keys(f.service.store.state.sessions).length, 0);
    time += 600000;
    await f.restart();
    assert.equal(
      (await f.rawApi("login", { ...input, recoverySaved: true })).value.error,
      "mfa-enrollment-expired",
    );
    const replacement = await f.rawApi("login", {
      username: "admin",
      password: permanent,
    });
    assert.notEqual(
      replacement.value.mfaEnrollment.challenge,
      pending.challenge,
    );
    assert.equal(
      (await f.rawApi("login", { ...input, recoverySaved: true })).status,
      409,
    );
  } finally {
    await f.finish();
  }
});

test("MFA rotation requires an existing factor, preserves it until confirmation and retires all old sessions", async () => {
  const time = Date.now();
  const f = await fixture({ manualMfa: true, clock: () => time });
  try {
    const enrolled = await enrollAdmin(f, time);
    const oldVersion = f.service.store.state.accounts.admin.mfa.version;
    assert.equal(
      (await f.rawApi("mfa/rotate", { password: permanent }, enrolled.cookie))
        .value.error,
      "invalid-mfa",
    );
    const began = await f.rawApi(
      "mfa/rotate",
      { password: permanent, mfaCode: enrolled.challenge.recoveryCodes[0] },
      enrolled.cookie,
    );
    assert.equal(began.status, 200);
    assert.equal(f.service.store.state.accounts.admin.mfa.version, oldVersion);
    const replacement = began.value.mfaEnrollment;
    const other = await f.rawApi("login", {
      username: "admin",
      password: permanent,
      mfaCode: enrolled.challenge.recoveryCodes[1],
    });
    const input = {
      mfaChallenge: replacement.challenge,
      recoverySaved: true,
      mfaCode: hotp(
        decodeMfaSecret(replacement.secret),
        Math.floor(time / 30000),
      ),
    };
    assert.equal(
      (await f.rawApi("mfa/confirm", input, other.cookie)).status,
      409,
    );
    const completed = await f.rawApi("mfa/confirm", input, enrolled.cookie);
    assert.equal(completed.status, 200);
    assert.equal(completed.value.recoveryCodesRemaining, 10);
    assert.equal(
      (await f.rawApi("session", undefined, enrolled.cookie)).status,
      401,
    );
    assert.equal(
      (await f.rawApi("session", undefined, other.cookie)).status,
      401,
    );
    assert.equal(
      (await f.rawApi("session", undefined, completed.cookie)).status,
      200,
    );
    assert.equal(
      (
        await f.rawApi("login", {
          username: "admin",
          password: permanent,
          mfaCode: enrolled.challenge.recoveryCodes[2],
        })
      ).value.error,
      "invalid-mfa",
    );
  } finally {
    await f.finish();
  }
});

test("the last recovery code can restore an authenticator, with a five-minute password reauthentication window", async () => {
  let time = Date.now();
  const f = await fixture({ manualMfa: true, clock: () => time });
  try {
    const enrolled = await enrollAdmin(f, time);
    f.service.store.transaction((state) => {
      state.accounts.admin.mfa.recovery =
        state.accounts.admin.mfa.recovery.slice(0, 1);
    });
    const recovered = await f.rawApi("login", {
      username: "admin",
      password: permanent,
      mfaCode: enrolled.challenge.recoveryCodes[0],
    });
    assert.equal(recovered.value.recoveryCodesRemaining, 0);
    assert.equal(
      (await f.rawApi("mfa/rotate", { password: "wrong" }, recovered.cookie))
        .status,
      401,
    );
    const pending = await f.rawApi(
      "mfa/rotate",
      { password: permanent },
      recovered.cookie,
    );
    assert.ok(pending.value.mfaEnrollment);
    time += 300001;
    assert.equal(
      (await f.rawApi("mfa/rotate", { password: permanent }, recovered.cookie))
        .status,
      401,
    );
    // An enrollment begun during the reauthentication window still has its bounded ten-minute confirmation lifetime.
    const { challenge, secret } = pending.value.mfaEnrollment;
    const confirmed = await f.rawApi(
      "mfa/confirm",
      {
        mfaChallenge: challenge,
        recoverySaved: true,
        mfaCode: hotp(decodeMfaSecret(secret), Math.floor(time / 30000)),
      },
      recovered.cookie,
    );
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.value.recoveryCodesRemaining, 10);
  } finally {
    await f.finish();
  }
});

test("a failed durable session write does not spend the recovery proof", async () => {
  const f = await fixture({ manualMfa: true });
  try {
    const enrolled = await enrollAdmin(f, Date.now());
    const file = f.service.store.file;
    f.service.store.file = path.join(
      f.directory,
      "missing-directory",
      "accounts.json",
    );
    const input = {
      username: "admin",
      password: permanent,
      mfaCode: enrolled.challenge.recoveryCodes[0],
    };
    const rejected = await f.rawApi("login", input);
    assert.equal(rejected.status, 500);
    assert.equal(rejected.cookie, undefined);
    assert.equal(f.service.store.state.accounts.admin.mfa.recovery.length, 10);
    f.service.store.file = file;
    assert.equal((await f.rawApi("login", input)).status, 200);
    assert.equal((await f.rawApi("login", input)).value.error, "invalid-mfa");
  } finally {
    await f.finish();
  }
});

test("TOTP accepts one future interval and rejects wider drift and old intervals", async () => {
  let time = Math.floor(Date.now() / 30000) * 30000;
  const f = await fixture({ manualMfa: true, clock: () => time });
  try {
    const enrolled = await enrollAdmin(f, time);
    const login = (step) =>
      f.rawApi("login", {
        username: "admin",
        password: permanent,
        mfaCode: hotp(enrolled.secret, step),
      });
    time += 90000;
    const step = Math.floor(time / 30000);
    assert.equal((await login(step - 2)).value.error, "invalid-mfa");
    assert.equal((await login(step + 2)).value.error, "invalid-mfa");
    assert.equal((await login(step - 1)).status, 200);
    assert.equal((await login(step + 1)).status, 200);
    assert.equal((await login(step)).value.error, "invalid-mfa");
  } finally {
    await f.finish();
  }
});

test("account signer uses service time for auth, plain messages and media despite device skew", async () => {
  const { accountSigner, setNativeLoginTransport } = await import(
    "../login-api.ts"
  );
  const f = await fixture();
  try {
    const admin = await f.setup();
    setNativeLoginTransport(async (route, input) => {
      const result = await f.api(route, input, admin.cookie);
      if (result.status !== 200) throw new Error(result.value.error);
      return result.value;
    });
    const signer = accountSigner(admin.value);
    const serverTime = (await f.api("status")).value.serverTime;
    assert.ok(Number.isSafeInteger(serverTime));
    for (const skew of [-31536000, -86400, 1, 86400, 31536000]) {
      const created_at = serverTime + skew;
      const operations = [
        {
          kind: 22242,
          created_at,
          content: "",
          tags: [
            ["relay", "wss://buzz.test"],
            ["challenge", "skew-test"],
          ],
        },
        {
          kind: 9,
          created_at,
          content: "시계가 틀려도 보내는 글",
          tags: [["h", "general"]],
        },
        ...["upload", "get"].map((verb) => ({
          kind: 24242,
          created_at,
          content: "Buzz file transfer",
          tags: [
            ["t", verb],
            ["x", "a".repeat(64)],
            ["server", "buzz.test"],
            ["expiration", String(created_at + 60)],
          ],
        })),
      ];
      for (const template of operations) {
        const event = await signer.sign(template);
        assert.ok(verifyEvent(event));
        assert.equal(event.content, template.content);
        assert.ok(
          Math.abs(event.created_at - Math.floor(Date.now() / 1000)) <= 2,
        );
        assert.equal(
          template.created_at,
          created_at,
          "does not mutate retry inputs",
        );
        if (event.kind === 24242)
          assert.equal(
            Number(event.tags.find((tag) => tag[0] === "expiration")[1]),
            event.created_at + 60,
          );
        else assert.deepEqual(event.tags, template.tags);
      }
    }
    signer.dispose();
  } finally {
    setNativeLoginTransport(undefined);
    await f.finish();
  }
});
