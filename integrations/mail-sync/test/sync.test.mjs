import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { Relay } from '../src/relay.mjs';
import { collectAccount, describeMail, selectFolders } from '../src/mail.mjs';
import { accounts, threeMonthsAgo } from '../src/config.mjs';
import { failStatus } from '../src/worker.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'buzz-mail-test-'));
  const store = new Store(dir); const relay = new Relay(store);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, store, relay };
}
const folder = { path: 'INBOX', flags: new Set() };
const raw = Buffer.from('From: sales@kovar.kr\r\nTo: nova@kovar.kr\r\nMessage-ID: <self@example.com>\r\nSubject: Inquiry INQ-01M3TM43\r\nDate: Thu, 1 Oct 2026 11:19:05 +0900\r\n\r\nOriginal inquiry');
function client(uids, options = {}) {
  const calls = [];
  return { calls,
    async connect() { calls.push('connect'); },
    async list() { return options.folders || [folder]; },
    async mailboxOpen(path, opts) {
      calls.push(['open', path, opts]);
      return { readOnly: opts.readOnly, exists: uids.length, uidValidity: options.validity || 1n,
        uidNext: options.next || Math.max(0, ...uids) + 1 };
    },
    async search(query, opts) { calls.push(['search', query, opts]); return uids; },
    async fetchOne(uid, query, opts) {
      calls.push(['fetch', uid, query, opts]);
      if (options.failure) throw new Error('Disconnected');
      if (query.source) return { source: options.unique ? Buffer.from(raw.toString().replace('self@example', `${uid}@example`)) : raw };
      return { uid: Number(uid), size: raw.length, envelope: {}, internalDate: new Date('2026-10-01T02:19:05Z') };
    },
    close() { calls.push('close'); },
  };
}
test('three calendar months are clamped and calculated using Korea date', () => {
  assert.equal(threeMonthsAgo(new Date('2026-10-04T17:00:00Z')), '2026-07-05');
  assert.equal(threeMonthsAgo(new Date('2026-05-31T01:00:00Z')), '2026-02-28');
});
test('read-only production collector, duplicate self-mail, durable cursor and queue', async (t) => {
  const { store, relay } = fixture(t); const imap = client([1, 2]);
  await collectAccount({ account: accounts[0], store, relay, client: imap });
  assert.equal(store.counts('kovar').collected, 1);
  assert.equal(store.cursor('kovar', 'INBOX', 1), 2);
  assert.equal(store.pending().length, 1);
  assert.match(JSON.parse(store.pending()[0].event).content, /수신·발신/);
  assert.deepEqual(imap.calls.find((c) => c[0] === 'open')[2], { readOnly: true });
  assert.equal(imap.calls.find((c) => c[0] === 'search')[1].since, store.get('since'));
  assert.equal(imap.calls.filter((c) => c[0] === 'fetch').every((c) => c[3].uid === true), true);
});
test('failed fetch cannot advance the persisted cursor', async (t) => {
  const { store, relay } = fixture(t);
  await assert.rejects(collectAccount({ account: accounts[0], store, relay, client: client([4], { failure: true }) }));
  assert.equal(store.cursor('kovar', 'INBOX', 1), 0);
  assert.equal(store.pending().length, 0);
});
test('atomic staging rolls back message when cursor persistence fails', (t) => {
  const { store, relay } = fixture(t);
  store.db.exec("CREATE TRIGGER reject_cursor BEFORE INSERT ON cursors BEGIN SELECT RAISE(FAIL, 'disk error'); END;");
  assert.throws(() => store.stage('kovar', 'INBOX', 1, 3, 'key', relay.sign(9, 'test')));
  assert.equal(store.pending().length, 0);
});
test('failed relay delivery preserves exact signed event for retry', async (t) => {
  const { store, relay } = fixture(t);
  const event = relay.sign(9, 'test', [['h', accounts[0].channel]]);
  store.stage('kovar', 'INBOX', 1, 1, 'key', event);
  const sent = []; relay.publish = async (value) => { sent.push(value); throw new Error('timeout'); };
  await assert.rejects(relay.drain());
  assert.equal(store.pending().length, 1);
  relay.publish = async (value) => { sent.push(value); };
  await relay.drain();
  assert.deepEqual(sent[0], sent[1]); assert.equal(store.pending().length, 0);
});
test('paused/replaced account fences in-flight fetch before durable staging', async (t) => {
  const { store, relay } = fixture(t); const imap = client([1]); let current = true;
  const fetch = imap.fetchOne;
  imap.fetchOne = async (...args) => { const value = await fetch(...args); current = false; return value; };
  await collectAccount({ account: accounts[0], store, relay, client: imap, current: () => current });
  assert.equal(store.pending().length, 0);
  assert.equal(store.cursor('kovar', 'INBOX', 1), 0);
});
test('new UIDVALIDITY restarts scan; dedup prevents repost; up-to-date avoids reverse ranges', async (t) => {
  const { store, relay } = fixture(t);
  await collectAccount({ account: accounts[0], store, relay, client: client([1]) });
  const second = client([1], { validity: 2n });
  await collectAccount({ account: accounts[0], store, relay, client: second });
  assert.equal(store.cursor('kovar', 'INBOX', 2), 1); assert.equal(store.counts('kovar').collected, 1);
  const third = client([1], { validity: 2n });
  await collectAccount({ account: accounts[0], store, relay, client: third });
  assert.equal(third.calls.some((c) => c[0] === 'search'), false);
});
test('backfill caps each cycle without skipping the remainder', async (t) => {
  const { store, relay } = fixture(t);
  const uids = Array.from({ length: 30 }, (_, i) => i + 1);
  assert.equal(await collectAccount({ account: accounts[0], store, relay, client: client(uids, { unique: true }) }), true);
  assert.equal(store.cursor('kovar', 'INBOX', 1), 25);
  assert.equal(store.counts('kovar').collected, 25);
  await collectAccount({ account: accounts[0], store, relay, client: client(uids, { unique: true }) });
  assert.equal(store.cursor('kovar', 'INBOX', 1), 30);
  assert.equal(store.counts('kovar').collected, 30);
});
test('Gmail uses All Mail; junk/drafts/trash excluded; Naver includes sent and archives', () => {
  const list = [folder, { path: 'All', specialUse: '\\All' }, { path: 'Sent', specialUse: '\\Sent' },
    { path: 'Trash', specialUse: '\\Trash' }, { path: 'Junk', specialUse: '\\Junk' }, { path: 'Drafts', specialUse: '\\Drafts' }];
  assert.deepEqual(selectFolders(accounts[0], list).map((f) => f.path), ['All']);
  assert.deepEqual(selectFolders(accounts[1], list).map((f) => f.path), ['INBOX', 'All', 'Sent']);
});
test('secrets encrypted at rest, only the intended installation key can decrypt', (t) => {
  const { store, dir } = fixture(t);
  store.setSecret('account:kovar', JSON.stringify({ password: 'mock-secret-123', enabled: true }));
  assert.doesNotMatch(store.get('account:kovar'), /mock-secret/);
  assert.equal(JSON.parse(store.secret('account:kovar')).password, 'mock-secret-123');
  assert.equal(readFileSync(join(dir, 'master.key')).length, 32);
});
test('forward received by Naver remains source-mailbox record, not fabricated sale', () => {
  const record = describeMail(accounts[1], folder, { from: { value: [{ address: 'sales@kovar.kr' }] },
    to: { value: [{ address: 'cbtcshin@naver.com' }] }, subject: 'Fwd: INQ-01M3TM43', text: '<script>hello</script>' }, {});
  assert.match(record.content, /청북 메일 · 수신/);
  assert.doesNotMatch(record.content, /판매 확정/);
  assert.doesNotMatch(record.content, /<script>/);
});
test('retry failures back off then require explicit recovery', () => {
  let state = {};
  for (let i = 0; i < 5; i++) state = failStatus(state, 'failure');
  assert.equal(state.state, 'attention'); assert.equal(state.failures, 5);
  assert.ok(state.nextAt > Date.now());
});
