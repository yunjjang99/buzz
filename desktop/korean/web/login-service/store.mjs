import fs from "node:fs";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");
export function username(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(value)
  )
    throw new Error("invalid-username");
  return value.toLowerCase();
}
export function password(value, minimum = 12) {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > 128 ||
    Buffer.byteLength(value) > 512
  )
    throw new Error("invalid-password");
  return value;
}
export async function passwordHash(
  value,
  salt = randomBytes(16).toString("hex"),
) {
  const hash = await derive(password(value, 1), salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt}:${hash.toString("hex")}`;
}
export async function passwordMatches(value, encoded) {
  const [salt, expected] = encoded.split(":");
  const actual = (await passwordHash(value, salt)).split(":")[1];
  return timingSafeEqual(
    Buffer.from(actual, "hex"),
    Buffer.from(expected, "hex"),
  );
}

/** Single-writer, fsynced snapshots; publish memory only after durable commit. */
export class Store {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = path.join(directory, "master.key");
    this.file = path.join(directory, "accounts.json");
    if (!fs.existsSync(keyPath)) {
      if (fs.existsSync(this.file)) throw new Error("missing-master-key");
      const fd = fs.openSync(keyPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, randomBytes(32));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
    this.key = fs.readFileSync(keyPath);
    if (this.key.length !== 32) throw new Error("invalid-master-key");
    this.state = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : { version: 1, accounts: {}, sessions: {} };
    if (
      this.state.version !== 1 ||
      !this.state.accounts ||
      !this.state.sessions ||
      Object.keys(this.state.accounts).length > 100
    )
      throw new Error("invalid-store");
  }
  transaction(change) {
    const next = structuredClone(this.state);
    const result = change(next);
    const data = JSON.stringify(next);
    if (Buffer.byteLength(data) > 2 * 1024 * 1024)
      throw new Error("store-capacity");
    const temporary = `${this.file}.next`;
    const fd = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, this.file);
    const directory = fs.openSync(this.directory, "r");
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
    this.state = next;
    return result;
  }
  seal(secret, pubkey) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(pubkey));
    const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      "base64",
    );
  }
  open(account) {
    const value = Buffer.from(account.key, "base64");
    if (value.length !== 60) throw new Error("invalid-key-envelope");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      value.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(account.pubkey));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([
      decipher.update(value.subarray(28)),
      decipher.final(),
    ]);
  }
}

/** Bounded fixed-window limiter; saturation rejects rather than evicting live limits. */
export class Limiter {
  constructor() {
    this.records = new Map();
  }
  take(key, maximum, windowMs) {
    const now = Date.now();
    for (const [id, record] of this.records)
      if (record.until <= now) this.records.delete(id);
    const record = this.records.get(key);
    if (!record && this.records.size >= 2048) throw new Error("rate-limited");
    const next = record ?? { until: now + windowMs, count: 0 };
    if (++next.count > maximum) throw new Error("rate-limited");
    this.records.set(key, next);
  }
}
