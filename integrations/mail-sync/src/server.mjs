import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Store } from './store.mjs';
import { Relay } from './relay.mjs';
import { Worker } from './worker.mjs';
import { verifyAccount } from './mail.mjs';
import { accounts } from './config.mjs';

process.umask(0o077);
const store = new Store(process.env.BUZZ_MAIL_DATA || './data');
const relay = new Relay(store);
const worker = new Worker(store, relay);
const session = randomBytes(32).toString('hex');
const busy = new Set();
const hosts = new Set(['localhost:8766', '127.0.0.1:8766']);
const html = readFileSync(new URL('./setup.html', import.meta.url));
const javascript = readFileSync(new URL('./setup-ui.js', import.meta.url));

function status() {
  return { since: store.get('since'), relay: store.status('relay'), classification: store.status('classification'), routing: worker.routing.counts(), accounts: accounts.map((account) => {
    const credential = JSON.parse(store.secret(`account:${account.id}`) || '{}');
    return { id: account.id, company: account.company, user: account.user, channel: account.channel, name: account.name,
      configured: Boolean(credential.password), enabled: Boolean(credential.enabled),
      ...store.counts(account.id), status: store.status(account.id) };
  }) };
}
function validSession(req) {
  const value = /(?:^|; )buzz_mail_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  return Boolean(value && timingSafeEqual(Buffer.from(value), Buffer.from(session)));
}
async function readJson(req) {
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 2048) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  try {
    if (!hosts.has(req.headers.host)) return send(403, { error: '이 Mac의 localhost 주소에서 접속하세요.' });
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
    if (req.method === 'GET' && req.url === '/') {
      res.setHeader('Set-Cookie', `buzz_mail_session=${session}; HttpOnly; SameSite=Strict; Path=/`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
    }
    if (!validSession(req)) return send(403, { error: '설정 화면을 새로고침하세요.' });
    if (req.method === 'GET' && req.url === '/setup-ui.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return res.end(javascript);
    }
    if (req.method === 'GET' && req.url === '/api/status') return send(200, status());
    if (req.method !== 'POST' || req.headers.origin !== `http://${req.headers.host}` ||
      req.headers['x-mail-sync'] !== '1' || req.headers['content-type'] !== 'application/json') {
      return send(403, { error: '설정 화면에서 다시 시도하세요.' });
    }
    const input = await readJson(req);
    if (req.url === '/api/retry') {
      for (const id of ['relay', 'classification', ...accounts.map((a) => a.id)]) store.status(id, { state: 'waiting' });
      worker.wake(); return send(200, { ok: true });
    }
    const account = accounts.find((candidate) => candidate.id === input.account);
    if (!account) return send(400, { error: '계정을 확인하세요.' });
    if (busy.has(account.id)) return send(409, { error: '이 계정의 연결 확인이 진행 중입니다.' });
    if (req.url === '/api/connect') {
      const password = String(input.password || '').replace(/\s/g, '');
      if (password.length < 8 || password.length > 128) return send(400, { error: '앱 비밀번호를 입력하세요.' });
      busy.add(account.id);
      try {
        await verifyAccount(account, password);
        store.setSecret(`account:${account.id}`, JSON.stringify({ password, enabled: true }));
        store.status(account.id, { state: 'waiting', message: '로그인 확인 완료. 수집을 시작합니다.' });
        worker.wake();
        return send(200, { ok: true });
      } catch { return send(400, { error: '로그인 확인 실패. 2단계 인증·앱 비밀번호와 IMAP 사용 설정을 확인하세요.' }); }
      finally { busy.delete(account.id); }
    }
    if (req.url === '/api/toggle' && typeof input.enabled === 'boolean') {
      const credential = JSON.parse(store.secret(`account:${account.id}`) || '{}');
      if (!credential.password) return send(400, { error: '먼저 계정을 연결하세요.' });
      store.setSecret(`account:${account.id}`, JSON.stringify({ ...credential, enabled: input.enabled }));
      store.status(account.id, { state: input.enabled ? 'waiting' : 'paused', message: input.enabled ? '수집 재개 대기' : '새 메일 수집 일시 중지. 이미 저장된 메일은 게시됩니다.' });
      worker.wake(); return send(200, { ok: true });
    }
    return send(404, { error: '요청을 찾을 수 없습니다.' });
  } catch { return send(500, { error: '요청을 처리하지 못했습니다. 상태를 확인하고 다시 시도하세요.' }); }
});
server.requestTimeout = 45000;
server.headersTimeout = 10000;
server.listen(8766, process.env.BUZZ_MAIL_BIND || '127.0.0.1', () => {
  console.log('Mail setup ready on port 8766; credentials are never logged.');
  worker.wake();
});
process.on('SIGTERM', () => { worker.stop(); server.close(); setTimeout(() => process.exit(0), 3000).unref(); });
