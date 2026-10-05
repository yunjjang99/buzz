export const destinations = {
  weborder: { id: '0a0dbee7-71a8-4586-9b00-9bd67fe2d82e', name: '코바-00-웹주문결제' },
  inquiry: { id: '029f08e7-d960-4fd9-8b56-69245b0ec669', name: '코바-01-견적요청' },
  quote: { id: '658a4d82-ce9c-4336-a402-db49549254cc', name: '코바-02-견적관리' },
  offer: { id: '7dd9cb57-d7e1-47b3-97b8-d07b52c1380c', name: '코바-03-공급처오퍼' },
  order: { id: 'c55861c3-5ad0-4a9b-880e-dbe55786a9a8', name: '코바-04-발주관리' },
  shipping: { id: '31a76f32-f821-4db7-88f2-08f9c39939aa', name: '코바-05-배송입고' },
  review: { id: 'a22159d0-d611-4793-9a1b-33612068c0b2', name: '01-공동메일분류' },
  operations: { id: '09e1c08a-36c3-4a16-a3bb-7ea7589a1ae2', name: '코바-08-운영관리', create: true },
  information: { id: '99ae137a-bd40-41bf-9b7d-b26a53bf67d5', name: '코바-09-정보알림', create: true },
};

const unescape = (text) => text.replace(/\\([\\`*_{}\[\]<>#])/g, '$1');
export function readMail(event) {
  const lines = event.content.split('\n');
  const heading = /^\*\*\[코바 메일 · ([^\]]+)\] (.*)\*\*$/.exec(lines[0]);
  const field = (name) => unescape(lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2) || '');
  const marker = lines.indexOf('> 아래는 원본 이메일 내용입니다.');
  const body = marker < 0 ? '' : unescape(lines.slice(marker + 1).map((line) => line.replace(/^> ?/, '')).join('\n'));
  // Only the latest contribution is evidence of a new action. Quoted history is not.
  const latest = body.split(/\n(?:On .{0,250}wrote:|.*님이 작성:|.*님이 다음을 작성:|[- ]*(?:Original Message|Forwarded message|전달된 메시지)[- ]*|>{1,}\s)/i)[0].slice(0, 6000);
  return { subject: heading ? unescape(heading[2]).trim() : '', direction: heading?.[1] || '확인 필요',
    from: field('보낸 사람'), to: field('받는 사람'), date: field('메일 날짜'),
    attachment: field('첨부파일 이름'), limitation: field('수집 범위 안내'), latest,
    sourceLink: /\[원본 메일함에서 확인\]\((https:\/\/mail\.google\.com\/[^\s)]+)\)/.exec(event.content)?.[1] };
}

export function classify(event) {
  const mail = readMail(event);
  const { subject: s, latest: b } = mail;
  const combined = `${s}\n${b}`;
  const reply = /^(?:re|fw|fwd)\s*:/i.test(s);
  const forwarded = /^(?:fw|fwd)\s*:/i.test(s);
  const sent = mail.direction === '발신';
  const result = (category, status, reason) => ({ category, status: forwarded ? `전달본 · ${status}` : status,
    reason, mail, version: 1 });
  const security = /인증|비밀번호|보안 알림|security alert|sign.in|verification|password|trusted device|remote device/i.test(s);
  if (security) return { ...result('operations', '계정·보안 알림', '계정 인증/보안 알림 제목'), sensitive: true };
  if (/베어링톡|뉴스레터|newsletter|unsubscribe|수신.?거부|\(광고\)|프로모션|할인행사|할인 혜택|discount|campaign|캠페인|확장 소재|광고|세법교실|webinar|제품 소식|개편소식|Film Festival|Best Bits|UMSALOU|User Meeting|New:.*pricing|Coding sessions now cost less/i.test(s)) {
    return result('information', '정보·홍보 알림', '뉴스레터/홍보/광고/교육 알림 제목');
  }
  if (/AWS|Amazon Web Services|Google Workspace|Google Ads|Anthropic|Claude|Search Console|색인|ALARM:|OK:|초대장|예약하기|클라우드|NHN KCP|네이버페이|토스페이먼츠|쿠팡|서명변경|해외송금/i.test(s) ||
      /(?:@|\.)(?:amazonaws\.com|google\.com|anthropic\.com|hometax\.go\.kr)>?(?:,|$)/i.test(mail.from)) {
    return result('operations', '서비스·운영 알림', 'IT 서비스/광고 운영/일정 관련 제목 또는 발신 도메인');
  }
  if (/CB-Q-\d|\bCBO-\d|Chungbook.?Quotation/i.test(combined)) {
    return result('review', '거래 회사 확인 필요', '청북 문서번호가 포함되어 코바 거래로 확정하지 않음');
  }
  if (mail.limitation) return result('review', '원문 확인 필요', '본문 일부 또는 전체가 수집되지 않아 자동 판정 보류');
  if (!s || s === '(제목 없음)') return result('review', '제목·내용 확인 필요', '제목이 없거나 저장된 메일 제목을 해석할 수 없음');
  if (/\[주문서\].*\bPO-\d+/i.test(s) && /코바|KOVAR/i.test(s)) {
    return result('weborder', '웹 주문 알림 · 결제상태 원문 확인', 'KOVAR 웹 주문서 제목과 PO 번호 일치');
  }
  if (/주문.*취소|환불/i.test(s) && /\bPO-\d+/.test(combined)) return result('weborder', '웹 주문 취소·환불 관련 안내', '원문에 PO 번호와 취소/환불 제목이 있음. 실제 환불 완료는 별도 확인');
  if (/FedEx|DHL|UPS\b|\bAWB\s*\d|운송장|통관|수출신고|배송|출고|입고|shipment|tracking|shipped|dispatch|delivery status|pick.?up/i.test(s)) {
    return result('shipping', '배송·입고 관련 메일', '배송/운송/통관/입출고 제목');
  }
  if (/\[견적요청 접수\]/.test(s)) {
    return result('inquiry', reply ? '접수확인 관련 회신' : '자동 접수확인 · 견적 발송 아님', '웹 문의 접수확인 제목');
  }
  if (/견적서.*송부|견적.*발송|KOVAR Quotation|공급 조건 안내/i.test(s) || (sent && /견적\s*회신/.test(s))) {
    return result('quote', reply ? '견적 관련 회신 · 새 견적 여부 확인' : sent ? '견적 안내 발신' : '견적 관련 수신',
      '견적서 송부/견적 안내 제목. 발행·수주·입금·판매 확정과 별개');
  }
  if (/purchase order|\bPO for\b|발주서|발주 확인|발주 요청|order confirmation|order acknowledgment/i.test(s)) {
    return result('order', '주문·발주 관련 메일 · 거래방향 확인', '주문/발주 문서 제목. 고객 주문과 공급처 발주는 원문 확인');
  }
  if (/세금.?계산서|인보이스|invoice|영수증|receipt|정산|납부|결제 내역/i.test(s)) {
    return result('operations', '회계·증빙 확인', '세금계산서/영수증/청구 관련 제목. 매출 확정으로 자동 집계하지 않음');
  }
  const request = /견적.?요청|견적.?문의|견적.?의뢰|견적문의|베어링.*문의|inquiry|\bRFQ(?=$|[^a-z0-9])|quotation request|request for quot|stock and price/i.test(s);
  const explicitQuote = /(?:please find|attached is|첨부한|첨부된).{0,100}(?:our quotation|our offer|the quotation|견적서)|견적서.{0,30}(?:송부|보내드|첨부하)|we (?:can|are pleased to) (?:offer|quote)/i.test(b);
  if (explicitQuote && !forwarded) return result(sent ? 'quote' : 'offer',
    sent ? '견적 안내 발신 · 원문 확인' : '오퍼·견적 회신 수신 후보', '최신 본문에 견적/오퍼 송부 표현이 있음');
  if (request) {
    if (sent && /진행 상황|진행상황|안내|답변|회신/i.test(s)) return result('inquiry', '문의 진행 안내 발신', '견적요청 관련 진행 안내 제목');
    if (sent && !reply && !/INQ-/.test(s)) return result('offer', '외부 견적요청 발신 · 공급처 여부 확인', '코바가 외부에 발신한 견적요청 제목');
    return result('inquiry', forwarded ? '문의 전달 · 신규 접수 집계 제외' : reply ? '문의 관련 회신' : '견적요청 수신', '문의/RFQ/견적요청 제목');
  }
  if (!forwarded && /please (?:kindly )?quote|please provide your best price|가격.{0,20}문의|구매 가능 여부|견적을 받고|견적.{0,10}부탁/i.test(b)) {
    return result(sent ? 'offer' : 'inquiry', sent ? '외부 견적요청 발신 · 공급처 여부 확인' : '구매·견적 문의 수신', '최신 본문에 가격/구매 가능 여부/견적 요청이 있음');
  }
  if (/\boffer\b|\bquotation\b|견적서|견적 회신/i.test(s) && !sent) {
    return result('offer', '오퍼·견적 수신 후보 · 상대 역할 확인', '수신 메일의 오퍼/견적 제목. 공급처 역할은 확인 필요');
  }
  if (/견적|\bRFQ\b|\bINQ-[A-Z0-9]+|베어링|\bbearing\b|\b(?:SKF|NSK|NTN|TIMKEN|KOYO|NADELLA)\b/i.test(combined)) {
    return result('review', '업무 종류 확인 필요', '베어링/견적 관련 내용은 있으나 업무 단계 근거 부족');
  }
  return result('review', '분류 확인 필요', '자동 분류 규칙에 맞는 충분한 근거 없음');
}

const escape = (text) => String(text || '').replace(/([\\`*_{}\[\]<>#])/g, '\\$1');
export function classificationContent(event, result) {
  const { mail } = result;
  const ids = [...new Set((`${mail.subject}\n${mail.latest}`).match(/\b(?:INQ-[A-Z0-9]+|PO-\d+|KVR-Q-[A-Z0-9-]+|RAVA-[A-Z0-9-]+)\b/gi) || [])].slice(0, 12);
  return [
    `**[코바 · ${result.status}] ${result.sensitive ? '계정·보안 알림 (원문 확인)' : escape(mail.subject).slice(0, 700)}**`,
    `메일 날짜: ${escape(mail.date)}`, `방향: ${mail.direction}`,
    result.sensitive ? '' : `발신: ${escape(mail.from)}\n수신: ${escape(mail.to)}`,
    `분류 근거: ${result.reason}`, ids.length ? `원문 참조번호: ${ids.map(escape).join(', ')}` : '',
    `상태는 메일 분류용이며 실제 견적·수주·결제·판매 확정을 뜻하지 않습니다.`,
    `[Buzz 원본 메일](buzz://message?channel=dfa0ae4b-d294-445c-8c79-84a8d563f5ef&id=${event.id})`,
    mail.sourceLink ? `[Gmail 원문](${mail.sourceLink})` : '',
    !result.sensitive && mail.latest ? `\n원문 앞부분:\n${escape(mail.latest.slice(0, 1200)).split('\n').map((line) => `> ${line}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}
