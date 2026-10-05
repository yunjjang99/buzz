import { accounts } from './config.mjs';
import { collectAccount } from './mail.mjs';
import { Routing } from './routing.mjs';
import { failStatus } from './retry.mjs';
export { failStatus } from './retry.mjs';

export class Worker {
  constructor(store, relay) { this.store = store; this.relay = relay; this.routing = new Routing(store, relay); this.running = false; this.stopped = false; }
  async run() {
    if (this.running || this.stopped) return;
    this.running = true;
    let more = false;
    try {
      const status = this.store.status('relay');
      if (status.state === 'attention' || (status.nextAt || 0) > Date.now()) return;
      try {
        if (this.store.get('relayReady') !== 'yes') await this.relay.setup();
        await this.relay.drain();
        this.store.status('relay', { state: 'ready', updated: new Date().toISOString() });
      } catch {
        this.store.status('relay', failStatus(status, 'Buzz 연결 실패. 서버와 메일연동 계정의 채널 권한을 확인한 뒤 다시 시도하세요.'));
        return;
      }
      // Backpressure: preserve pending events before downloading more mail.
      if (this.store.pending(500).length >= 500) { more = true; return; }
      for (const account of accounts) {
        const settingKey = `account:${account.id}`;
        const generation = this.store.get(settingKey);
        const credential = JSON.parse(this.store.secret(settingKey) || '{}');
        const previous = this.store.status(account.id);
        if (!credential.enabled || previous.state === 'attention' || (previous.nextAt || 0) > Date.now()) continue;
        const current = () => !this.stopped && this.store.get(settingKey) === generation;
        this.store.status(account.id, { ...previous, state: 'collecting', message: '받은메일·보낸메일 수집 중' });
        try {
          const backlog = await collectAccount({ account, password: credential.password, store: this.store, relay: this.relay, current });
          if (current()) this.store.status(account.id, { state: backlog ? 'backfill' : 'watching',
            updated: new Date().toISOString(), message: backlog ? '과거 메일을 이어서 가져오는 중' : '새 메일 확인 대기 · 약 2분 간격' });
          more ||= backlog;
        } catch {
          if (current()) this.store.status(account.id, failStatus(previous,
            '메일 수집 실패. 인터넷 연결·IMAP 사용 설정·앱 비밀번호를 확인하세요. 반복 실패하면 다시 시도가 필요합니다.'));
        }
      }
      try { await this.relay.drain(); }
      catch {
        this.store.status('relay', failStatus(this.store.status('relay'), 'Buzz 게시 실패. 저장된 메일은 재시도 대기 중입니다.'));
      }
      more = (await this.routing.run()) || more;
    } finally {
      this.running = false;
      if (!this.stopped) this.timer = setTimeout(() => this.run().catch(() => {
        this.store.status('relay', { state: 'attention', message: '저장소 또는 수집기 오류. 서비스 점검이 필요합니다.' });
      }), more ? 10000 : 120000);
    }
  }
  wake() { clearTimeout(this.timer); if (!this.running) void this.run().catch(() => {
    this.store.status('relay', { state: 'attention', message: '저장소 또는 수집기 오류. 서비스 점검이 필요합니다.' });
  }); }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}
