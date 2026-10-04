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
    });
    return {
      status: result.status,
      value: await result.json(),
      cookie: result.headers.get("set-cookie")?.split(";")[0],
      cookieHeader: result.headers.get("set-cookie"),
      retryAfter: result.headers.get("retry-after"),
    };
  }
  return {
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
