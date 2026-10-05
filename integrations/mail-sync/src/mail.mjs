import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { createHash } from 'node:crypto';
import { batchSize, maxSourceBytes } from './config.mjs';

export function makeClient(account, password) {
  const client = new ImapFlow({ host: account.host, port: 993, secure: true,
    auth: { user: account.user, pass: password }, logger: false,
    connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 30000,
    disableAutoIdle: true, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true } });
  // ImapFlow also emits errors. The pending command rejects; never log credentials.
  client.on('error', () => {});
  return client;
}

export function selectFolders(account, folders) {
  if (folders.length > 200) throw new Error('Too many mail folders');
  const usable = folders.filter((folder) => !folder.flags?.has('\\Noselect') &&
    !['\\Junk', '\\Trash', '\\Drafts'].includes(folder.specialUse) &&
    !/(^|[/|])(?:spam|trash|junk|drafts|스팸메일함|휴지통|임시보관함)$/i.test(folder.path));
  const all = usable.find((folder) => folder.specialUse === '\\All');
  return account.id === 'kovar' && all ? [all] : usable;
}

const addresses = (value) => (Array.isArray(value) ? value : value?.value || [])
  .map((item) => item.address || '').filter(Boolean);
const clean = (value, length = 1500) => String(value || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, length);
const safe = (value, length) => clean(value, length).replace(/([\\`*_{}\[\]<>#])/g, '\\$1');

export function describeMail(account, folder, parsed, metadata, limitation = null) {
  const envelope = metadata.envelope || {};
  const from = addresses(parsed.from || envelope.from);
  const to = addresses(parsed.to || envelope.to);
  const cc = addresses(parsed.cc || envelope.cc);
  const isOwn = (address) => account.aliases.includes(address.toLowerCase());
  const sent = folder.specialUse === '\\Sent' || from.some(isOwn);
  const received = [...to, ...cc].some(isOwn) || !sent;
  const direction = sent ? received ? '수신·발신' : '발신' : '수신';
  const subject = parsed.subject || envelope.subject || '(제목 없음)';
  const messageId = parsed.messageId || envelope.messageId || '';
  const date = parsed.date || envelope.date || metadata.internalDate;
  const text = parsed.text || '';
  const fingerprint = JSON.stringify([messageId, from, subject, date, text,
    (parsed.attachments || []).map((a) => [a.filename, a.checksum])]);
  const key = createHash('sha256').update(fingerprint).digest('hex');
  const attachments = (parsed.attachments || []).slice(0, 100).map((a) => safe(a.filename || '(이름 없음)', 200));
  const truncated = text.length > 18000;
  const limits = [limitation, truncated ? '긴 본문은 앞부분만 표시' : null].filter(Boolean);
  const sourceLink = account.id === 'kovar' && messageId
    ? `https://mail.google.com/mail/u/${encodeURIComponent(account.user)}/#search/${encodeURIComponent(`rfc822msgid:${messageId}`)}`
    : 'https://mail.naver.com/';
  const content = [
    `**[${account.company} 메일 · ${direction}] ${safe(subject, 500)}**`,
    `메일함: ${account.user} / ${safe(folder.path, 200)}`,
    `메일 날짜: ${date ? new Date(date).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '확인 필요'} (한국 시간)`,
    `보낸 사람: ${safe(from.join(', '))}`, `받는 사람: ${safe(to.join(', '))}`,
    cc.length ? `참조: ${safe(cc.join(', '))}` : null,
    `원본 Message-ID: ${safe(messageId || '(없음)', 500)}`,
    `[원본 메일함에서 확인](${sourceLink})`,
    attachments.length ? `첨부파일 이름: ${attachments.join(', ')} (파일 원본은 메일함에서 확인)` : null,
    limits.length ? `수집 범위 안내: ${limits.join(' / ')}` : null,
    '', '> 아래는 원본 이메일 내용입니다.',
    ...safe(text || '(본문 없음 또는 원본 확인 필요)', 18000).split('\n').map((line) => `> ${line}`),
  ].filter((line) => line !== null).join('\n');
  // Escaping and UTF-8 expansion must still fit the relay's 64 KiB contract.
  let bounded = content;
  while (Buffer.byteLength(bounded) > 60000) bounded = bounded.slice(0, -1000);
  return { key, content: bounded, limitation: limits.join(' / ') || null };
}

export async function collectAccount({ account, password, store, relay, current = () => true,
  client = makeClient(account, password), parse = simpleParser }) {
  let remaining = batchSize;
  let more = false;
  const deadline = setTimeout(() => client.close(), 240000);
  try {
    await client.connect();
    const folders = selectFolders(account, await client.list());
    if (!folders.length) throw new Error('No readable mail folders');
    for (const folder of folders) {
      if (!current()) return false;
      const mailbox = await client.mailboxOpen(folder.path, { readOnly: true });
      if (!mailbox.readOnly) throw new Error('Mailbox was not opened read-only');
      if (mailbox.exists > 250000) throw new Error('Mailbox exceeds collection limit');
      const validity = String(mailbox.uidValidity);
      const last = Number(mailbox.uidNext) - 1;
      const cursor = store.cursor(account.id, folder.path, validity);
      // Avoid IMAP's reversed UID ranges when cursor has already reached UIDNEXT.
      if (cursor >= last || last < 1) continue;
      const found = await client.search({ since: store.get('since'), uid: `${cursor + 1}:${last}`, draft: false }, { uid: true });
      if (!Array.isArray(found) || found.length > 250000) throw new Error('Invalid mail search response');
      const uids = found.filter((uid) => uid > cursor && uid <= last).sort((a, b) => a - b);
      if (uids.length > remaining) more = true;
      for (const uid of uids.slice(0, remaining)) {
        if (!current()) return false;
        const metadata = await client.fetchOne(String(uid), { uid: true, size: true, envelope: true, internalDate: true }, { uid: true });
        if (!metadata) throw new Error('Mail disappeared during collection; retrying');
        let parsed = {}; let limitation = null;
        if (metadata.size > maxSourceBytes) limitation = '8 MiB를 초과하여 본문·첨부파일명 미수집. 원본 메일 확인 필요';
        else {
          const full = await client.fetchOne(String(uid), { source: { maxLength: maxSourceBytes + 1 } }, { uid: true });
          if (!full?.source || full.source.length > maxSourceBytes) throw new Error('Invalid mail source size');
          parsed = await parse(full.source, { skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true });
        }
        if (!current()) return false;
        const record = describeMail(account, folder, parsed, metadata, limitation);
        const event = relay.sign(9, record.content, [['h', account.channel]]);
        store.stage(account.id, folder.path, validity, uid, record.key, event, record.limitation);
        remaining--;
      }
      if (!current()) return false;
      // Only advance beyond the fetched UIDs when this folder is fully drained.
      if (!uids.length || store.cursor(account.id, folder.path, validity) >= uids.at(-1)) {
        store.advance(account.id, folder.path, validity, last);
      }
      if (remaining <= 0) { more = true; break; }
    }
    return more;
  } finally {
    clearTimeout(deadline);
    client.close();
  }
}

export async function verifyAccount(account, password) {
  const client = makeClient(account, password);
  const deadline = setTimeout(() => client.close(), 35000);
  try {
    await client.connect();
    const folders = selectFolders(account, await client.list());
    if (!folders.length) throw new Error('No readable mailbox');
    const mailbox = await client.mailboxOpen(folders[0].path, { readOnly: true });
    if (!mailbox.readOnly) throw new Error('Read-only mailbox unavailable');
  } finally { clearTimeout(deadline); client.close(); }
}
