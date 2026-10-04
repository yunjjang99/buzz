import { test } from "node:test";
import assert from "node:assert/strict";
import { base32, hotp } from "./mfa.mjs";

test("RFC 6238 Appendix B SHA-1 vectors including post-2038 timestamps", () => {
  const secret = Buffer.from("12345678901234567890");
  for (const [time, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])
    assert.equal(hotp(secret, Math.floor(time / 30), 8), expected);
});
test("RFC 4648 Base32 vectors have no padding and preserve secret bits", () => {
  for (const [plain, encoded] of [
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ])
    assert.equal(base32(Buffer.from(plain)), encoded);
});
