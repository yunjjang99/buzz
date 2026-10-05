import { classify, classificationContent, destinations } from './classify.mjs';
import { failStatus } from './retry.mjs';

export class Routing {
  constructor(store, relay) { this.store = store; this.relay = relay; }
  async setup() {
    if (this.store.get('routingReady') === 'v1') return;
    for (const target of Object.values(destinations)) {
      if (target.create) {
        const found = await this.relay.query({ kinds: [39000], '#d': [target.id], limit: 1 });
        if (!found.length) await this.relay.publish(this.relay.sign(9007, '', [
          ['h', target.id], ['name', target.name], ['visibility', 'open'], ['channel_type', 'stream'],
          ['about', target.name.endsWith('운영관리') ? '코바 메일의 서비스 운영·계정 보안·회계 증빙 분류. 판매 확정으로 집계하지 않습니다. 원본은 메일연동 채널과 Gmail에서 확인합니다.' : '코바 메일의 뉴스레터·제품 정보·광고·교육 알림 자동 분류. 원본은 메일연동 채널과 Gmail에서 확인합니다.'],
        ]));
      }
      await this.relay.publish(this.relay.sign(9021, '', [['h', target.id]]));
    }
    this.store.set('routingReady', 'v1');
  }
  stage(limit = 50) {
    const rows = this.store.db.prepare(`SELECT m.account,m.key,m.event FROM messages m
      LEFT JOIN classifications c ON c.account=m.account AND c.key=m.key
      WHERE m.account='kovar' AND m.sent=1 AND c.key IS NULL ORDER BY m.rowid LIMIT ?`).all(limit);
    for (const row of rows) {
      const source = JSON.parse(row.event);
      const result = classify(source);
      const event = this.relay.sign(9, classificationContent(source, result), [['h', destinations[result.category].id]]);
      this.store.db.prepare(`INSERT OR IGNORE INTO classifications(account,key,category,status,reason,event)
        VALUES (?,?,?,?,?,?)`).run(row.account, row.key, result.category, result.status, result.reason, JSON.stringify(event));
    }
    return rows.length;
  }
  async drain(limit = 50) {
    const rows = this.store.db.prepare('SELECT account,key,event FROM classifications WHERE sent=0 ORDER BY rowid LIMIT ?').all(limit);
    for (const row of rows) {
      await this.relay.publish(JSON.parse(row.event));
      this.store.db.prepare('UPDATE classifications SET sent=1 WHERE account=? AND key=?').run(row.account, row.key);
    }
    for (const row of this.store.db.prepare(`SELECT r.* FROM classification_refinements r JOIN classifications c
      ON r.account=c.account AND r.key=c.key WHERE r.sent=0 AND c.sent=1 LIMIT ?`).all(limit)) {
      await this.relay.publish(JSON.parse(row.resolution_event));
      this.store.db.prepare('UPDATE classification_refinements SET sent=1 WHERE account=? AND key=?').run(row.account, row.key);
    }
  }
  refineReviews() {
    if (this.store.get('reviewRefinement') === 'v1') return;
    const rows = this.store.db.prepare(`SELECT c.account,c.key,c.event,m.event AS source FROM classifications c
      JOIN messages m ON c.account=m.account AND c.key=m.key WHERE c.category='review' AND c.sent=1 LIMIT 1000`).all();
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const source = JSON.parse(row.source); const result = classify(source);
        if (result.category === 'review') continue;
        const previous = JSON.parse(row.event); const target = destinations[result.category];
        const event = this.relay.sign(9, classificationContent(source, result), [['h', target.id]]);
        const note = this.relay.sign(9, `분류 보완 완료: #${target.name}로 분류했습니다. 이 메일의 분류 확인 요청은 해결되었습니다.\n[최종 분류 게시물](buzz://message?channel=${target.id}&id=${event.id})`,
          [['h', destinations.review.id], ['e', previous.id, '', 'root']]);
        this.store.db.prepare('INSERT OR IGNORE INTO classification_refinements(account,key,previous_event,resolution_event) VALUES (?,?,?,?)')
          .run(row.account,row.key,row.event,JSON.stringify(note));
        this.store.db.prepare('UPDATE classifications SET category=?,status=?,reason=?,event=?,sent=0 WHERE account=? AND key=?')
          .run(result.category,result.status,result.reason,JSON.stringify(event),row.account,row.key);
      }
      this.store.set('reviewRefinement','v1'); this.store.db.exec('COMMIT');
    } catch(error) { this.store.db.exec('ROLLBACK'); throw error; }
  }
  counts() {
    return this.store.db.prepare('SELECT category,COUNT(*) AS classified,SUM(sent) AS posted FROM classifications GROUP BY category').all();
  }
  remaining() {
    return this.store.db.prepare(`SELECT COUNT(*) AS n FROM messages m LEFT JOIN classifications c
      ON m.account=c.account AND m.key=c.key WHERE m.account='kovar' AND m.sent=1 AND (c.key IS NULL OR c.sent=0)`).get().n +
      this.store.db.prepare('SELECT COUNT(*) AS n FROM classification_refinements WHERE sent=0').get().n;
  }
  async run() {
    const previous = this.store.status('classification');
    if (previous.state === 'attention' || (previous.nextAt || 0) > Date.now()) return false;
    try {
      await this.setup();
      await this.drain();
      this.refineReviews();
      this.stage();
      await this.drain();
      const remaining = this.remaining();
      this.store.status('classification', { state: remaining ? 'backfill' : 'watching', remaining,
        updated: new Date().toISOString(), message: remaining ? '기존 메일을 업무 채널로 분류 중' : '기존 메일 분류 완료 · 새 메일 자동 분류 중' });
      return remaining > 0;
    } catch {
      this.store.status('classification', failStatus(previous, '업무 채널 분류/게시 실패. 저장된 분류 결과를 유지하고 재시도합니다.'));
      return false;
    }
  }
}
