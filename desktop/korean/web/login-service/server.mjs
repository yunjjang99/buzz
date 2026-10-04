import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { decrypt, encrypt } from "nostr-tools/nip49";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import {
  Store,
  Limiter,
  username,
  password,
  passwordHash,
  passwordMatches,
  hashToken,
} from "./store.mjs";
import { RelayBridge } from "./relay.mjs";
import { assertNoKeys, validateBackup } from "../protocol.ts";

const DESKTOP_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);
const COOKIE = "__Host-buzz_session";
const now = () => Math.floor(Date.now() / 1000);
const publicAccount = (account) => ({
  username: account.username,
  name: account.name,
  pubkey: account.pubkey,
  role: account.role,
  mustChangePassword: account.mustChangePassword,
  status: account.job?.status ?? "ready",
  provisioningError: account.job?.error ?? "",
});
function failure(code, status = 400) {
  const error = new Error(code);
  error.status = status;
  return error;
}
function displayName(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 80 ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw failure("invalid-name");
  return value.trim();
}

/** A small separate login service; the relay remains authoritative for channel access. */
export async function createLoginService(options) {
  const origin = new URL(options.origin).origin;
  const owner = options.owner;
  if (
    !/^[a-f0-9]{64}$/.test(owner) ||
    (!origin.startsWith("https://") && !options.testing)
  )
    throw new Error("invalid-configuration");
  const store = new Store(options.directory);
  const bridge = options.bridge ?? new RelayBridge(origin, options.internal);
  const limiter = new Limiter();
  const dummyHash = await passwordHash(randomBytes(32).toString("hex"));
  let hashing = 0;
  let importing = false;
  let jobRunning = false;
  let stopped = false;
  async function limitedHash(action) {
    if (hashing >= 2) throw failure("rate-limited", 429);
    ++hashing;
    try {
      return await action();
    } finally {
      --hashing;
    }
  }
  async function importKey(backup, passphrase) {
    validateBackup(backup);
    password(passphrase, 1);
    if (importing) throw failure("rate-limited", 429);
    importing = true;
    try {
      return await new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), {
          workerData: { backup, password: passphrase },
          resourceLimits: { maxOldGenerationSizeMb: 96 },
        });
        let done = false;
        const finish = (error, key) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          void worker.terminate();
          if (error) reject(error);
          else resolve(Buffer.from(key));
        };
        const timer = setTimeout(
          () => finish(failure("backup-unlock-failed")),
          30000,
        );
        worker.on("message", (data) =>
          data.key
            ? finish(null, data.key)
            : finish(failure("backup-unlock-failed")),
        );
        worker.on("error", () => finish(failure("backup-unlock-failed")));
        worker.on("exit", () => {
          if (!done) finish(failure("backup-unlock-failed"));
        });
      });
    } finally {
      importing = false;
    }
  }
  async function exportKey(account, passphrase) {
    if (importing) throw failure("rate-limited", 429);
    importing = true;
    const key = store.open(account);
    try {
      return await new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), {
          workerData: { exportKey: key, password: passphrase },
          resourceLimits: { maxOldGenerationSizeMb: 96 },
        });
        let done = false;
        const finish = (error, value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          void worker.terminate();
          if (error) reject(error);
          else resolve(value);
        };
        const timer = setTimeout(
          () => finish(failure("backup-unlock-failed")),
          30000,
        );
        worker.on("message", (data) =>
          data.backup
            ? finish(null, data.backup)
            : finish(failure("backup-unlock-failed")),
        );
        worker.on("error", () => finish(failure("backup-unlock-failed")));
        worker.on("exit", () => {
          if (!done) finish(failure("backup-unlock-failed"));
        });
      });
    } finally {
      key.fill(0);
      importing = false;
    }
  }
  function withKey(account, action) {
    const key = store.open(account);
    try {
      return action(key);
    } finally {
      key.fill(0);
    }
  }
  async function withAsyncKey(account, action) {
    const key = store.open(account);
    try {
      return await action(key);
    } finally {
      key.fill(0);
    }
  }
  function ownerAccount() {
    const account = Object.values(store.state.accounts).find(
      (item) => item.pubkey === owner && item.role === "admin",
    );
    if (!account) throw failure("setup-required", 503);
    return account;
  }
  async function channels() {
    return await withAsyncKey(ownerAccount(), async (key) => {
      const memberships = await bridge.query(key, {
        kinds: [39002],
        "#p": [owner],
        limit: 1000,
      });
      const ids = [
        ...new Set(
          memberships
            .map((event) => event.tags.find((tag) => tag[0] === "d")?.[1])
            .filter(Boolean),
        ),
      ];
      if (!ids.length) return [];
      const metadata = await bridge.query(key, {
        kinds: [39000],
        "#d": ids,
        limit: 1000,
      });
      const found = new Map();
      for (const event of metadata.sort(
        (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
      )) {
        const id = event.tags.find((tag) => tag[0] === "d")?.[1];
        if (!ids.includes(id) || found.has(id)) continue;
        const type = event.tags.find((tag) => tag[0] === "t")?.[1];
        if (
          type === "dm" ||
          event.tags.some((tag) => tag[0] === "archived" && tag[1] === "true")
        )
          continue;
        found.set(id, {
          id,
          name: event.tags.find((tag) => tag[0] === "name")?.[1] ?? id,
        });
      }
      return [...found.values()];
    });
  }
  function session(request) {
    const bearer = request.headers.authorization?.match(
      /^Bearer ([a-f0-9]{64})$/,
    )?.[1];
    const desktop = DESKTOP_ORIGINS.has(request.headers.origin);
    const cookie = desktop
      ? bearer
      : request.headers.cookie
          ?.split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${COOKIE}=`))
          ?.slice(COOKIE.length + 1);
    if (!cookie || !/^[a-f0-9]{64}$/.test(cookie))
      throw failure("login-required", 401);
    const id = hashToken(cookie);
    const saved = store.state.sessions[id];
    const account = saved && store.state.accounts[saved.username];
    if (
      !saved ||
      saved.until <= now() ||
      !account ||
      !account.enabled ||
      Boolean(saved.desktop) !== desktop
    )
      throw failure("login-required", 401);
    return { account, id };
  }
  function admin(request) {
    const current = session(request);
    if (current.account.role !== "admin" || current.account.pubkey !== owner)
      throw failure("admin-required", 403);
    return current;
  }
  function issueSession(state, account, remember, desktop = false) {
    for (const [id, saved] of Object.entries(state.sessions))
      if (saved.until <= now()) delete state.sessions[id];
    const own = Object.entries(state.sessions)
      .filter(([, saved]) => saved.username === account.username)
      .sort((a, b) => a[1].until - b[1].until);
    for (const [id] of own.slice(0, Math.max(0, own.length - 7)))
      delete state.sessions[id];
    if (Object.keys(state.sessions).length >= 256)
      throw failure("session-capacity", 503);
    const token = randomBytes(32).toString("hex");
    const duration = remember ? 30 * 86400 : 8 * 3600;
    state.sessions[hashToken(token)] = {
      username: account.username,
      desktop,
      until: now() + duration,
    };
    return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict${remember ? `; Max-Age=${duration}` : ""}`;
  }
  function signed(account, kind, tags, content = "") {
    return withKey(account, (key) =>
      finalizeEvent({ kind, tags, content, created_at: now() }, key),
    );
  }
  async function runJobs() {
    if (jobRunning || stopped) return;
    jobRunning = true;
    try {
      for (const item of Object.values(store.state.accounts)) {
        if (
          !item.job ||
          item.job.status === "ready" ||
          item.job.status === "failed" ||
          item.job.nextAt > now()
        )
          continue;
        const name = item.username;
        const step = item.job.steps[item.job.index];
        try {
          await withAsyncKey(
            step.actor === "owner" ? ownerAccount() : item,
            (key) => bridge.publish(key, step.event),
          );
          store.transaction((state) => {
            const job = state.accounts[name].job;
            ++job.index;
            job.attempts = 0;
            job.error = "";
            job.nextAt = now();
            if (job.index === job.steps.length) {
              job.status = "ready";
              job.steps = [];
            }
          });
        } catch {
          store.transaction((state) => {
            const job = state.accounts[name].job;
            ++job.attempts;
            job.error = "relay-provisioning-failed";
            job.nextAt = now() + Math.min(60, 2 ** job.attempts);
            if (job.attempts >= 6) job.status = "failed";
          });
        }
      }
    } finally {
      jobRunning = false;
    }
  }
  function schedule() {
    if (!options.disableJobs)
      void runJobs().catch(() => {
        console.error("provisioning-storage-failed");
      });
  }
  const timer = setInterval(schedule, 1000);
  timer.unref();
  async function body(request) {
    if (
      !/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")
    )
      throw failure("json-required", 415);
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 80 * 1024) throw failure("request-too-large", 413);
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw failure("invalid-request");
    }
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const send = (value, status = 200) => {
      response.statusCode = status;
      response.end(JSON.stringify(value));
    };
    try {
      const route = request.url;
      const desktop = DESKTOP_ORIGINS.has(request.headers.origin);
      if (desktop) {
        response.setHeader(
          "Access-Control-Allow-Origin",
          request.headers.origin,
        );
        response.setHeader("Vary", "Origin");
        response.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, OPTIONS",
        );
        response.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization",
        );
        if (request.method === "OPTIONS") return send({ ok: true });
      }
      if (request.method === "GET" && route === "/chat-api/status")
        return send({
          configured: Object.keys(store.state.accounts).length > 0,
        });
      if (request.method === "GET" && route === "/chat-api/session")
        return send(publicAccount(session(request).account));
      if (request.method === "GET" && route === "/chat-api/admin/accounts") {
        admin(request);
        return send(Object.values(store.state.accounts).map(publicAccount));
      }
      if (request.method === "GET" && route === "/chat-api/admin/channels") {
        admin(request);
        return send(await channels());
      }
      if (request.method !== "POST") throw failure("not-found", 404);
      if (request.headers.origin !== origin && !desktop)
        throw failure("invalid-origin", 403);
      const ip = (
        request.headers["x-forwarded-for"]?.split(",").at(-1)?.trim() ??
        request.socket.remoteAddress ??
        "unknown"
      ).slice(0, 80);
      limiter.take("global", 600, 60000);
      limiter.take(`ip:${ip}`, 120, 60000);
      const input = await body(request);
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw failure("invalid-request");
      if (route === "/chat-api/setup") {
        limiter.take(`setup:${ip}`, 5, 15 * 60000);
        if (Object.keys(store.state.accounts).length)
          throw failure("already-configured", 409);
        const name = username(input.username);
        password(input.password);
        const label = displayName(input.name);
        const hash = await limitedHash(() => passwordHash(input.password));
        const key = await importKey(input.backup, input.backupPassword);
        try {
          if (getPublicKey(key) !== owner)
            throw failure("owner-backup-required", 403);
          const cookie = store.transaction((state) => {
            if (Object.keys(state.accounts).length)
              throw failure("already-configured", 409);
            const account = {
              username: name,
              name: label,
              pubkey: owner,
              key: store.seal(key, owner),
              hash,
              role: "admin",
              enabled: true,
              mustChangePassword: false,
            };
            state.accounts[name] = account;
            return issueSession(state, account, false, desktop);
          });
          response.setHeader("Set-Cookie", cookie);
          return send({
            ...publicAccount(store.state.accounts[name]),
            ...(desktop
              ? { desktopToken: cookie.split(";")[0].split("=")[1] }
              : {}),
          });
        } finally {
          key.fill(0);
        }
      }
      if (route === "/chat-api/login" || route === "/chat-api/desktop/login") {
        if (desktop !== (route === "/chat-api/desktop/login"))
          throw failure("invalid-origin", 403);
        const name = username(input.username);
        password(input.password, 1);
        limiter.take(`login-ip:${ip}`, 30, 5 * 60000);
        limiter.take(`login-user:${name}`, 15, 5 * 60000);
        const account = store.state.accounts[name];
        const encoded = account?.hash ?? dummyHash;
        const valid = await limitedHash(() =>
          passwordMatches(input.password, encoded),
        );
        if (!valid || !account?.enabled) throw failure("invalid-login", 401);
        if (account.job && account.job.status !== "ready")
          throw failure("account-provisioning", 409);
        let replacementHash = null;
        if (desktop && account.mustChangePassword) {
          if (!input.newPassword)
            throw failure("password-change-required", 409);
          password(input.newPassword);
          if (input.newPassword === input.password)
            throw failure("password-unchanged");
          replacementHash = await limitedHash(() =>
            passwordHash(input.newPassword),
          );
        }
        const encrypted = desktop
          ? await exportKey(
              account,
              input.newPassword && replacementHash
                ? input.newPassword
                : input.password,
            )
          : null;
        const cookie = store.transaction((state) => {
          const current = state.accounts[name];
          if (current.hash !== encoded || !current.enabled)
            throw failure("invalid-login", 401);
          if (replacementHash) {
            current.hash = replacementHash;
            current.mustChangePassword = false;
            for (const [id, saved] of Object.entries(state.sessions))
              if (saved.username === name) delete state.sessions[id];
          }
          return issueSession(state, current, input.remember === true, desktop);
        });
        response.setHeader("Set-Cookie", cookie);
        return send(
          desktop
            ? {
                account: publicAccount(store.state.accounts[name]),
                backup: encrypted,
                token: cookie.split(";")[0].split("=")[1],
              }
            : publicAccount(store.state.accounts[name]),
        );
      }
      const current = session(request);
      if (route === "/chat-api/logout") {
        store.transaction((state) => {
          delete state.sessions[current.id];
        });
        response.setHeader(
          "Set-Cookie",
          `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
        );
        return send({ ok: true });
      }
      if (route === "/chat-api/password") {
        password(input.password);
        if (input.password === input.currentPassword)
          throw failure("password-unchanged");
        const encoded = current.account.hash;
        if (
          !(await limitedHash(() =>
            passwordMatches(input.currentPassword, encoded),
          ))
        )
          throw failure("invalid-login", 401);
        const hash = await limitedHash(() => passwordHash(input.password));
        store.transaction((state) => {
          const account = state.accounts[current.account.username];
          if (account.hash !== encoded || !state.sessions[current.id])
            throw failure("login-required", 401);
          account.hash = hash;
          account.mustChangePassword = false;
          for (const [id, saved] of Object.entries(state.sessions))
            if (saved.username === account.username && id !== current.id)
              delete state.sessions[id];
        });
        return send(
          publicAccount(store.state.accounts[current.account.username]),
        );
      }
      if (route === "/chat-api/sign") {
        const template = input.template;
        if (
          !template ||
          !Number.isInteger(template.created_at) ||
          Math.abs(template.created_at - now()) > 90 ||
          typeof template.content !== "string" ||
          !Array.isArray(template.tags) ||
          template.tags.length > 16 ||
          template.tags.some(
            (tag) =>
              !Array.isArray(tag) ||
              tag.length > 5 ||
              tag.some(
                (value) => typeof value !== "string" || value.length > 256,
              ),
          )
        )
          throw failure("invalid-event");
        if (template.kind === 22242) {
          if (
            template.content !== "" ||
            template.tags.length !== 2 ||
            template.tags[0]?.[0] !== "relay" ||
            template.tags[0]?.[1] !==
              origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:") ||
            template.tags[1]?.[0] !== "challenge" ||
            !template.tags[1]?.[1]
          )
            throw failure("invalid-auth-event");
        } else if (template.kind === 9) {
          if (current.account.mustChangePassword)
            throw failure("password-change-required", 403);
          if (
            !template.content.trim() ||
            Buffer.byteLength(template.content) > 65536 ||
            !template.tags.some((tag) => tag[0] === "h" && tag[1])
          )
            throw failure("invalid-message");
          assertNoKeys(template.content);
        } else throw failure("unsupported-operation", 403);
        return send(
          withKey(current.account, (key) => finalizeEvent(template, key)),
        );
      }
      admin(request);
      if (route === "/chat-api/admin/create") {
        const name = username(input.username);
        const label = displayName(input.name);
        password(input.password);
        if (
          !Array.isArray(input.channels) ||
          input.channels.length > 12 ||
          input.channels.some((id) => typeof id !== "string")
        )
          throw failure("invalid-channels");
        if (store.state.accounts[name]) throw failure("username-taken", 409);
        if (Object.keys(store.state.accounts).length >= 100)
          throw failure("account-capacity", 409);
        const allowed = await channels();
        const selected = [...new Set(input.channels)];
        if (
          selected.some((id) => !allowed.some((channel) => channel.id === id))
        )
          throw failure("invalid-channels", 403);
        const hash = await limitedHash(() => passwordHash(input.password));
        const key = input.backup
          ? await importKey(input.backup, input.backupPassword)
          : generateSecretKey();
        try {
          const pubkey = getPublicKey(key);
          const account = {
            username: name,
            name: label,
            pubkey,
            key: store.seal(key, pubkey),
            hash,
            role: "member",
            enabled: true,
            mustChangePassword: true,
          };
          const steps = [
            {
              actor: "owner",
              event: signed(ownerAccount(), 9030, [
                ["p", pubkey],
                ["role", "member"],
              ]),
            },
          ];
          for (const channel of selected)
            steps.push({
              actor: "owner",
              event: signed(ownerAccount(), 9000, [
                ["h", channel],
                ["p", pubkey],
                ["role", "member"],
              ]),
            });
          // Imported identities keep their existing public profile and every prior channel.
          if (!input.backup)
            steps.push({
              actor: "employee",
              event: finalizeEvent(
                {
                  kind: 0,
                  tags: [],
                  content: JSON.stringify({ name: label, display_name: label }),
                  created_at: now(),
                },
                key,
              ),
            });
          account.job = {
            status: "pending",
            steps,
            index: 0,
            attempts: 0,
            nextAt: now(),
            error: "",
          };
          store.transaction((state) => {
            if (!state.sessions[current.id])
              throw failure("login-required", 401);
            if (
              state.accounts[name] ||
              Object.values(state.accounts).some(
                (item) => item.pubkey === pubkey,
              )
            )
              throw failure("account-already-exists", 409);
            if (Object.keys(state.accounts).length >= 100)
              throw failure("account-capacity", 409);
            state.accounts[name] = account;
          });
          schedule();
          return send(publicAccount(account), 201);
        } finally {
          key.fill(0);
        }
      }
      if (route === "/chat-api/admin/retry") {
        const name = username(input.username);
        store.transaction((state) => {
          const job = state.accounts[name]?.job;
          if (job?.status !== "failed") throw failure("no-failed-job");
          job.status = "pending";
          job.attempts = 0;
          job.nextAt = now();
        });
        schedule();
        return send({ ok: true });
      }
      if (route === "/chat-api/admin/reset") {
        const name = username(input.username);
        password(input.password);
        const target = store.state.accounts[name];
        if (!target || target.role === "admin")
          throw failure("invalid-account");
        const hash = await limitedHash(() => passwordHash(input.password));
        store.transaction((state) => {
          if (!state.sessions[current.id]) throw failure("login-required", 401);
          state.accounts[name].hash = hash;
          state.accounts[name].mustChangePassword = true;
          for (const [id, saved] of Object.entries(state.sessions))
            if (saved.username === name) delete state.sessions[id];
        });
        return send({ ok: true });
      }
      throw failure("not-found", 404);
    } catch (error) {
      const status =
        error.status ??
        (error.message === "rate-limited"
          ? 429
          : [
                "invalid-username",
                "invalid-password",
                "key-in-message",
                "unsupported-backup",
                "encrypted-backup-required",
              ].includes(error.message)
            ? 400
            : 500);
      send({ error: status === 500 ? "service-error" : error.message }, status);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxConnections = 64;
  return {
    server,
    store,
    runJobs,
    close: async () => {
      stopped = true;
      clearInterval(timer);
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (!isMainThread) {
  try {
    if (workerData.exportKey) {
      parentPort.postMessage({
        backup: encrypt(
          new Uint8Array(workerData.exportKey),
          workerData.password,
          16,
        ),
      });
    } else {
      parentPort.postMessage({
        key: decrypt(validateBackup(workerData.backup), workerData.password),
      });
    }
  } catch {
    parentPort.postMessage({ error: "backup-unlock-failed" });
  }
} else if (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")
) {
  createLoginService({
    origin: process.env.BUZZ_LOGIN_ORIGIN,
    owner: process.env.BUZZ_LOGIN_OWNER,
    directory: process.env.BUZZ_LOGIN_DATA ?? "/data",
    internal: process.env.BUZZ_LOGIN_RELAY_INTERNAL ?? "http://relay:3000",
  })
    .then(({ server }) => {
      server.listen(3101, "0.0.0.0", () =>
        console.log("Buzz login service listening"),
      );
    })
    .catch(() => {
      console.error("login-service-start-failed");
      process.exitCode = 1;
    });
}
