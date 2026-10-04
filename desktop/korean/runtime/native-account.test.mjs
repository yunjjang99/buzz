import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeApi, hasNativeSession } from "./native-account.ts";

test("late login and MFA rotation responses cannot restore a logged-out desktop session", async () => {
  const original = globalThis.fetch;
  const pending = [];
  globalThis.fetch = (_url, options) =>
    new Promise((resolve) => pending.push({ resolve, options }));
  const complete = (index, body) =>
    pending[index].resolve(new Response(JSON.stringify(body), { status: 200 }));
  try {
    const first = nativeApi("desktop/login", {
      username: "fixture",
      password: "synthetic",
    });
    const rejected = assert.rejects(first, /취소/);
    const logout = nativeApi("logout", {});
    complete(1, { ok: true });
    await logout;
    complete(0, { token: "a".repeat(64) });
    await rejected;
    assert.equal(hasNativeSession(), false);

    const initial = nativeApi("desktop/login", {});
    complete(2, { token: "b".repeat(64) });
    await initial;
    const rotation = nativeApi("mfa/confirm", {});
    const rotationRejected = assert.rejects(rotation, /취소/);
    const secondLogout = nativeApi("logout", {});
    complete(4, { ok: true });
    await secondLogout;
    complete(3, { desktopToken: "c".repeat(64) });
    await rotationRejected;
    assert.equal(hasNativeSession(), false);
  } finally {
    globalThis.fetch = original;
  }
});
