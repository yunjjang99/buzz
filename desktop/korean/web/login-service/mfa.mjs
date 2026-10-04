import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hashToken } from "./store.mjs";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** RFC 4648 unpadded Base32 for authenticator provisioning. */
export function base32(bytes) {
  let bits = 0,
    value = 0,
    result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits) result += ALPHABET[(value << (5 - bits)) & 31];
  return result;
}
/** RFC 4226 dynamic truncation, used by RFC 6238 TOTP. */
export function hotp(secret, step, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits,
  ).padStart(digits, "0");
}
function matchStep(secret, code, time, lastStep = -1) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(time / 30_000);
  for (const step of [current, current - 1, current + 1]) {
    if (
      step >= 0 &&
      step > lastStep &&
      timingSafeEqual(Buffer.from(code), Buffer.from(hotp(secret, step)))
    )
      return step;
  }
  return null;
}
const recoveryHash = (account, code) =>
  hashToken(`mfa-recovery:${account.pubkey}:${code}`);
const normalizeRecovery = (code) =>
  typeof code === "string" && /^[a-f\d-]{32,35}$/i.test(code)
    ? code.replaceAll("-", "").toLowerCase()
    : "";

/** Domain-separated encryption uses the existing 32-byte secret envelope. */
export class Mfa {
  constructor(store, origin, clock) {
    this.store = store;
    this.origin = origin;
    this.clock = clock;
  }
  open(account, envelope) {
    return this.store.open({ key: envelope, pubkey: `mfa:${account.pubkey}` });
  }
  /** Start or replace a ten-minute pending enrollment; active MFA stays in force. */
  begin(account, sessionId = null) {
    const secret = randomBytes(32);
    const challenge = randomBytes(32).toString("hex");
    const recoveryCodes = Array.from({ length: 10 }, () =>
      randomBytes(16).toString("hex").match(/.{8}/g).join("-"),
    );
    try {
      account.mfaEnrollment = {
        secret: this.store.seal(secret, `mfa:${account.pubkey}`),
        challenge: hashToken(challenge),
        until: this.clock() + 600_000,
        credential: account.hash,
        sessionId,
        version: account.mfa?.version ?? null,
        recovery: recoveryCodes.map((code) =>
          recoveryHash(account, normalizeRecovery(code)),
        ),
      };
      const encoded = base32(secret);
      const issuer = new URL(this.origin).host;
      return {
        mfaEnrollment: {
          challenge,
          secret: encoded,
          recoveryCodes,
          uri: `otpauth://totp/${encodeURIComponent(`${issuer}:${account.username}`)}?secret=${encoded}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`,
        },
      };
    } finally {
      secret.fill(0);
    }
  }
  /** Check pending ownership and expiry without issuing authentication privileges. */
  enrollment(account, input, sessionId = null) {
    const pending = account.mfaEnrollment;
    return pending &&
      typeof input.mfaChallenge === "string" &&
      input.mfaChallenge.length === 64 &&
      pending.challenge === hashToken(input.mfaChallenge) &&
      pending.until > this.clock() &&
      pending.credential === account.hash &&
      pending.version === (account.mfa?.version ?? null) &&
      pending.sessionId === sessionId &&
      input.recoverySaved === true
      ? pending
      : null;
  }
  /** Confirm possession before activation; caller commits this together with session rotation. */
  confirm(account, input, sessionId = null) {
    const pending = this.enrollment(account, input, sessionId);
    if (!pending) return false;
    const secret = this.open(account, pending.secret);
    try {
      const step = matchStep(secret, input.mfaCode, this.clock());
      if (step === null) return false;
      account.mfa = {
        secret: pending.secret,
        recovery: pending.recovery,
        version: randomBytes(16).toString("hex"),
        lastStep: step,
      };
      delete account.mfaEnrollment;
      return true;
    } finally {
      secret.fill(0);
    }
  }
  /** One-time proof consumption must be in the same transaction as its protected action. */
  consume(account, code) {
    if (!account.mfa) return false;
    const recovery = normalizeRecovery(code);
    if (recovery.length === 32) {
      const index = account.mfa.recovery.indexOf(
        recoveryHash(account, recovery),
      );
      if (index < 0) return false;
      account.mfa.recovery.splice(index, 1);
      return true;
    }
    const secret = this.open(account, account.mfa.secret);
    try {
      const step = matchStep(secret, code, this.clock(), account.mfa.lastStep);
      if (step === null) return false;
      account.mfa.lastStep = step;
      return true;
    } finally {
      secret.fill(0);
    }
  }
}
