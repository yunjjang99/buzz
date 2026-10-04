import { test } from "node:test";
import assert from "node:assert/strict";
import { enrollNativeIdentity } from "./native-enrollment.ts";
test("native enrollment preserves durable identities and fences verification before import", async () => {
  let imported = 0;
  const ops = {
    verify: async () => ({ pubkey: "staff", matchesCurrentIdentity: false }),
    import: async () => {
      ++imported;
      return { pubkey: "staff", storage: "system-keyring" };
    },
  };
  const active = () => {};
  await assert.rejects(
    enrollNativeIdentity(
      { pubkey: "owner", storage: "system-keyring" },
      "staff",
      "encrypted",
      "password",
      false,
      active,
      ops,
    ),
    /기존 앱 계정/,
  );
  assert.equal(imported, 0);
  await assert.rejects(
    enrollNativeIdentity(
      { pubkey: "temporary", storage: "ephemeral" },
      "other",
      "encrypted",
      "password",
      false,
      active,
      ops,
    ),
    /백업 검증/,
  );
  await assert.rejects(
    enrollNativeIdentity(
      { pubkey: "temporary", storage: "ephemeral" },
      "staff",
      "encrypted",
      "password",
      false,
      () => {
        throw new Error("cancelled");
      },
      ops,
    ),
    /cancelled/,
  );
  assert.equal(imported, 0);
  await enrollNativeIdentity(
    { pubkey: "temporary", storage: "ephemeral" },
    "staff",
    "encrypted",
    "password",
    false,
    active,
    ops,
  );
  assert.equal(imported, 1);
  await assert.rejects(
    enrollNativeIdentity(
      { pubkey: "owner", storage: "system-keyring" },
      "staff",
      "encrypted",
      "password",
      true,
      active,
      ops,
    ),
    /같은 아이디/,
  );
  assert.equal(imported, 1);
});
