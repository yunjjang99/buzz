import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { atServerTime, readServerTime } from "../server-time.ts";
import { accountSigner, setNativeLoginTransport } from "../login-api.ts";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

const secret = new Uint8Array(32).fill(1);
const account = { pubkey: getPublicKey(secret) };
const template = {
  kind: 9,
  created_at: 1,
  content: "message",
  tags: [["h", "general"]],
};

test("missing server time fails closed before signing; retry can recover", async () => {
  let healthy = false;
  let signs = 0;
  setNativeLoginTransport(async (route, input) => {
    if (route === "status")
      return healthy ? { serverTime: 1800000000 } : { configured: true };
    signs++;
    return finalizeEvent(input.template, secret);
  });
  try {
    const signer = accountSigner(account);
    await assert.rejects(signer.sign(template), /server-time-unavailable/);
    assert.equal(signs, 0);
    healthy = true;
    const signed = await signer.sign(template);
    assert.equal(signed.created_at, 1800000000);
    assert.equal(signs, 1);
  } finally {
    setNativeLoginTransport(undefined);
  }
});

test("logout while obtaining server time cannot dispatch a signing request", async () => {
  let complete;
  let signs = 0;
  setNativeLoginTransport((route) => {
    if (route === "status")
      return new Promise((resolve) => {
        complete = resolve;
      });
    signs++;
    throw new Error("unexpected signing");
  });
  try {
    const signer = accountSigner(account);
    const pending = signer.sign(template);
    signer.dispose();
    complete({ serverTime: 1800000000 });
    await assert.rejects(pending, /locked/);
    assert.equal(signs, 0);
  } finally {
    setNativeLoginTransport(undefined);
  }
});

test("server time does not permit changed message content from the signer", async () => {
  setNativeLoginTransport(async (route, input) =>
    route === "status"
      ? { serverTime: 1800000000 }
      : finalizeEvent({ ...input.template, content: "tampered" }, secret),
  );
  try {
    await assert.rejects(
      accountSigner(account).sign(template),
      /invalid-signature/,
    );
  } finally {
    setNativeLoginTransport(undefined);
  }
});

test("time reads bypass cache and never fall back to the PC clock", async () => {
  mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    return Response.json({ serverTime: 1800000000 });
  });
  try {
    assert.equal(await readServerTime(), 1800000000);
  } finally {
    mock.restoreAll();
  }
  mock.method(globalThis, "fetch", async () =>
    Response.json({ configured: true }),
  );
  try {
    await assert.rejects(readServerTime(), /server-time-unavailable/);
  } finally {
    mock.restoreAll();
  }
});

test("rebasing does not legitimize longer or duplicate media expiration", () => {
  for (const tags of [
    [["expiration", "3601"]],
    [
      ["expiration", "61"],
      ["expiration", "61"],
    ],
  ]) {
    assert.throws(
      () => atServerTime({ ...template, kind: 24242, tags }, 1800000000),
      /invalid-media/,
    );
  }
});
