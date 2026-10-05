import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { threeMonthsAgo } from './config.mjs';

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const keyPath = join(directory, 'master.key');
    try { this.key = readFileSync(keyPath); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.key = randomBytes(32);
      writeFileSync(keyPath, this.key, { mode: 0o600, flag: 'wx' });
    }
    if (this.key.length !== 32) throw new Error('Invalid installation key');
    this.db = new DatabaseSync(join(directory, 'mail.sqlite'));
    chmodSync(join(directory, 'mail.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      PRAGMA max_page_count=131072;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cursors (account TEXT, folder TEXT, validity TEXT, uid INTEGER,
        PRIMARY KEY(account, folder));
      CREATE TABLE IF NOT EXISTS messages (account TEXT, key TEXT, event TEXT NOT NULL,
        sent INTEGER NOT NULL DEFAULT 0, limitation TEXT, PRIMARY KEY(account,key));
      CREATE TABLE IF NOT EXISTS status (account TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS classifications (account TEXT, key TEXT, category TEXT NOT NULL,
        status TEXT NOT NULL, reason TEXT NOT NULL, event TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(account,key));
      CREATE TABLE IF NOT EXISTS classification_refinements (account TEXT, key TEXT,
        previous_event TEXT NOT NULL, resolution_event TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(account,key));`);
    if (!this.get('since')) this.set('since', threeMonthsAgo());
    if (!this.get('identity')) this.setSecret('identity', randomBytes(32).toString('hex'));
  }
  get(key) { return this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value; }
  set(key, value) { this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, value); }
  setSecret(key, value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    this.set(key, Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64'));
  }
  secret(key) {
    const value = this.get(key);
    if (!value) return undefined;
    const bytes = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
  }
  cursor(account, folder, validity) {
    const row = this.db.prepare('SELECT * FROM cursors WHERE account=? AND folder=?').get(account, folder);
    return row?.validity === String(validity) ? row.uid : 0;
  }
  advance(account, folder, validity, uid) {
    this.db.prepare('INSERT OR REPLACE INTO cursors VALUES (?,?,?,?)')
      .run(account, folder, String(validity), uid);
  }
  stage(account, folder, validity, uid, key, event, limitation = null) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR IGNORE INTO messages(account,key,event,limitation) VALUES (?,?,?,?)')
        .run(account, key, JSON.stringify(event), limitation);
      this.advance(account, folder, validity, uid);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  pending(limit = 50) {
    return this.db.prepare('SELECT account,key,event FROM messages WHERE sent=0 ORDER BY rowid LIMIT ?').all(limit);
  }
  delivered(account, key) {
    this.db.prepare('UPDATE messages SET sent=1 WHERE account=? AND key=?').run(account, key);
  }
  counts(account) {
    return this.db.prepare(`SELECT COUNT(*) AS collected, COALESCE(SUM(sent),0) AS delivered,
      COALESCE(SUM(limitation IS NOT NULL),0) AS limited FROM messages WHERE account=?`).get(account);
  }
  status(account, value) {
    if (value) this.db.prepare('INSERT OR REPLACE INTO status VALUES (?,?)').run(account, JSON.stringify(value));
    return JSON.parse(this.db.prepare('SELECT value FROM status WHERE account=?').get(account)?.value || '{}');
  }
  close() { this.db.close(); }
}
