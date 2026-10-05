import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { origin, internalOrigin, accounts } from './config.mjs';

export class Relay {
  constructor(store) {
    this.store = store;
    this.secret = Uint8Array.from(Buffer.from(store.secret('identity'), 'hex'));
    this.pubkey = getPublicKey(this.secret);
  }
  sign(kind, content, tags = []) {
    return finalizeEvent({ kind, content, tags, created_at: Math.floor(Date.now() / 1000) }, this.secret);
  }
  async request(route, payload) {
    const body = JSON.stringify(payload);
    const auth = this.sign(27235, '', [
      ['u', `${origin}${route}`], ['method', 'POST'],
      ['payload', createHash('sha256').update(body).digest('hex')],
      ['nonce', randomBytes(16).toString('hex')],
    ]);
    const url = new URL(route, internalOrigin);
    return new Promise((resolve, reject) => {
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        method: 'POST', headers: { Host: new URL(origin).host,
          'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
          Authorization: `Nostr ${Buffer.from(JSON.stringify(auth)).toString('base64')}` },
      }, (res) => {
        const chunks = []; let length = 0;
        res.on('data', (chunk) => {
          length += chunk.length;
          if (length > 2 * 1024 * 1024) res.destroy(new Error('Relay response too large'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`Relay HTTP ${res.statusCode}`));
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (error) { reject(error); }
        });
      });
      const timer = setTimeout(() => req.destroy(new Error('Relay timeout')), 15000);
      req.on('close', () => clearTimeout(timer));
      req.on('error', reject);
      req.end(body);
    });
  }
  async query(filter) {
    const events = await this.request('/query', [filter]);
    if (!Array.isArray(events) || events.length > 1000 || !events.every(verifyEvent)) {
      throw new Error('Invalid relay events');
    }
    return events;
  }
  async publish(event) {
    const result = await this.request('/events', event);
    if (result.accepted === true && result.event_id === event.id) return;
    // The server may have committed an event before a previous request timed out.
    const prior = await this.query({ kinds: [event.kind], ids: [event.id], limit: 1 });
    if (prior.some((row) => row.id === event.id)) return;
    throw new Error(`Relay rejected kind ${event.kind}`);
  }
  async setup() {
    for (const account of accounts) {
      const existing = await this.query({ kinds: [39000], '#d': [account.channel], limit: 1 });
      if (!existing.length) {
        await this.publish(this.sign(9007, '', [['h', account.channel], ['name', account.name],
          ['visibility', 'open'], ['channel_type', 'stream'],
          ['about', `${account.user} 받은메일·보낸메일 수집. 최근 3개월부터, 이후 자동 수집. 원본 메일함 기준으로 구분하며 거래 회사·견적 발송·판매 확정은 원문 확인이 필요합니다. 첨부파일은 이름만 표시합니다.`]]));
      }
      await this.publish(this.sign(9021, '', [['h', account.channel]]));
    }
    await this.publish(this.sign(0, JSON.stringify({ name: '메일연동', display_name: '코바·청북 메일연동',
      about: '메일함의 받은메일·보낸메일을 수집합니다. 자동 회신은 견적 발송이나 판매 확정을 뜻하지 않습니다.' })));
    this.store.set('relayReady', 'yes');
  }
  async drain() {
    for (const row of this.store.pending()) {
      await this.publish(JSON.parse(row.event));
      this.store.delivered(row.account, row.key);
    }
  }
}
