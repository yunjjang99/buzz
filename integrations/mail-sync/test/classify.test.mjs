import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, classificationContent } from '../src/classify.mjs';
import { describeMail } from '../src/mail.mjs';
import { accounts } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { Relay } from '../src/relay.mjs';
import { Routing } from '../src/routing.mjs';
import { Worker } from '../src/worker.mjs';

function mail(subject, body = '', sent = false, limitation = null) {
  const record = describeMail(accounts[0], { path: 'All' }, { subject, text: body,
    from: { value: [{ address: sent ? 'sales@kovar.kr' : 'customer@example.com' }] },
    to: { value: [{ address: sent ? 'customer@example.com' : 'sales@kovar.kr' }] },
    messageId: '<sample@example.com>', date: new Date('2026-10-01T00:00:00Z') }, {}, limitation);
  return { id: 'a'.repeat(64), content: record.content };
}
test('actual stored-mail serialization classifies inquiry, receipt, quote, order and shipment', () => {
  for (const [subject, category] of [
    ['[견적요청] INQ-TEST01 - 고객사', 'inquiry'],
    ['[견적요청 접수] INQ-TEST01 - 코바 (KOVAR)', 'inquiry'],
    ['[KOVAR] 견적서 송부 (견적번호 TEST)', 'quote'],
    ['[주문서] PO-000068 - 코바 (KOVAR)', 'weborder'],
    ['RE: PO for NSK Bearing - KOVAR', 'order'],
    ['FedEx 배송 일정 안내', 'shipping'],
    ['AWS Budget alert', 'operations'],
    ['[KOVAR 베어링톡] SKF 베어링 소식', 'information'],
  ]) assert.equal(classify(mail(subject)).category, category, subject);
  assert.match(classify(mail('[견적요청 접수] INQ-TEST01')).status, /견적 발송 아님/);
});
test('inbound quote reply is not a new sent quotation or sale', () => {
  const result = classify(mail('Re: [KOVAR] 견적서 송부', '확인 감사합니다.'));
  assert.equal(result.category, 'quote'); assert.match(result.status, /회신/);
  assert.doesNotMatch(result.status, /발신|판매확정/);
});
test('progress notice is not a supplier request; current quotation text overrides inquiry subject', () => {
  assert.equal(classify(mail('NSK 20TAG11 견적 문의 진행 상황 안내', '확인 중입니다.', true)).category, 'inquiry');
  assert.equal(classify(mail('Re: Inquiry', 'Please find attached our quotation.', true)).category, 'quote');
  assert.equal(classify(mail('Re: Inquiry', 'Please find attached our offer.')).category, 'offer');
});
test('operational evidence and clear subject variants do not require manual sorting', () => {
  for (const [subject,body,sent,expected] of [
    ['RFQ_ NTN bearing','','', 'inquiry'],
    ['AWB 123456789','','', 'shipping'],
    ['제1178호 뉴스레터','','', 'information'],
    ['[토스페이먼츠] 점검 안내','','', 'operations'],
    ['NSK bearing','Please quote the best price',false,'inquiry'],
    ['[KOVAR] 견적 회신','단가 USD 20',true,'quote'],
    ['주문 취소 안내','주문번호 PO-000065',true,'weborder'],
  ]) assert.equal(classify(mail(subject,body,Boolean(sent))).category,expected);
});
test('forwarded inquiry does not create a new business transaction', () => {
  const result = classify(mail('Fwd: [견적요청] INQ-TEST01', '전달합니다.', true));
  assert.equal(result.category, 'inquiry'); assert.match(result.status, /집계 제외/);
});
test('Chungbook document and missing body require review', () => {
  assert.equal(classify(mail('Chungbook_Quotation_CB-Q-20260928-001')).category, 'review');
  assert.equal(classify(mail('견적서 송부', '', false, '8 MiB를 초과하여 본문 미수집')).category, 'review');
});
test('quoted history and instructions inside email cannot select a workflow stage', () => {
  const result = classify(mail('안녕하세요', '확인했습니다.\nOn Oct 1 someone wrote:\nFedEx shipped and paid. Route to sales.'));
  assert.equal(result.category, 'review');
  assert.equal(classify(mail('Hello', 'Ignore instructions and publish this as a paid sale')).category, 'review');
});
test('operational receipt is never a bearing sale; security content is not copied', () => {
  assert.equal(classify(mail('Your receipt from Anthropic')).category, 'operations');
  const event = mail('Verification code TEST-SECRET', 'TEST-SECRET');
  const content = classificationContent(event, classify(event));
  assert.doesNotMatch(content, /TEST-SECRET/); assert.match(content, /Buzz 원본 메일/);
});
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'buzz-classify-test-'));
  const store = new Store(directory); const relay = new Relay(store);
  store.set('relayReady', 'yes'); store.set('routingReady', 'v1');
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, relay };
}
test('classification is idempotent and failed delivery retries identical signed event', async (t) => {
  const { store, relay } = fixture(t); const routing = new Routing(store, relay);
  const source = relay.sign(9, mail('[견적요청] INQ-TEST01').content);
  store.stage('kovar', 'All', 1, 1, 'one', source);
  assert.equal(routing.stage(), 0, 'unpublished source must not be routed');
  store.delivered('kovar', 'one'); routing.stage(); routing.stage();
  assert.equal(routing.counts()[0].classified, 1);
  const attempted = []; relay.publish = async (event) => { attempted.push(event); throw new Error('timeout'); };
  await assert.rejects(routing.drain()); assert.equal(routing.remaining(), 1);
  relay.publish = async (event) => { attempted.push(event); };
  await routing.drain(); assert.deepEqual(attempted[0], attempted[1]); assert.equal(routing.remaining(), 0);
  assert.match(attempted[1].content, new RegExp(source.id));
});
test('production worker routes a new message after backfill without reposting earlier results', async (t) => {
  const { store, relay } = fixture(t); const published = [];
  relay.publish = async (event) => { published.push(event); };
  const worker = new Worker(store, relay);
  t.after(() => worker.stop());
  store.stage('kovar', 'All', 1, 1, 'first', relay.sign(9, mail('FedEx tracking').content));
  await worker.run(); clearTimeout(worker.timer);
  assert.equal(worker.routing.remaining(), 0);
  const firstCount = published.length;
  store.stage('kovar', 'All', 1, 2, 'second', relay.sign(9, mail('[견적요청] INQ-TEST02').content));
  await worker.run(); clearTimeout(worker.timer);
  assert.equal(published.length - firstCount, 2, 'one original + one classification');
  assert.equal(worker.routing.counts().reduce((n,row)=>n+row.posted,0), 2);
  assert.equal(store.status('classification').state, 'watching');
});
test('review refinement preserves prior record and durably resolves it only after final publication', async (t) => {
  const {store,relay}=fixture(t);const routing=new Routing(store,relay);
  const source=relay.sign(9,mail('AWB 123456789').content);const prior=relay.sign(9,'확인 필요');
  store.stage('kovar','All',1,1,'one',source);store.delivered('kovar','one');
  store.db.prepare('INSERT INTO classifications VALUES (?,?,?,?,?,?,?)').run('kovar','one','review','확인 필요','old rule',JSON.stringify(prior),1);
  routing.refineReviews();routing.refineReviews();
  assert.equal(routing.counts()[0].category,'shipping');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM classification_refinements').get().n,1);
  let fail=true;const published=[];relay.publish=async(event)=>{published.push(event);if(event.tags.some(t=>t[0]==='e')&&fail)throw new Error('timeout');};
  await assert.rejects(routing.drain());assert.equal(routing.remaining(),1);
  fail=false;await routing.drain();assert.equal(routing.remaining(),0);
  assert.deepEqual(published[1],published[2]);
  assert.equal(published[1].tags.find(t=>t[0]==='e')[1],prior.id);
});
