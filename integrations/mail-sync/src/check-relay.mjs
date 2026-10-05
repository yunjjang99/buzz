import { Store } from './store.mjs';
import { Relay } from './relay.mjs';
import { accounts } from './config.mjs';

const store = new Store(process.env.BUZZ_MAIL_DATA || './data');
const relay = new Relay(store);
try {
  for (const account of accounts) {
    const key = `welcome:${account.id}`;
    let event = store.get(key) ? JSON.parse(store.get(key)) : null;
    if (!event) {
      event = relay.sign(9, `📬 ${account.company} 메일 수집 채널\n\n` +
        `원본 계정: ${account.user}\n최초 수집 범위: ${store.get('since')}부터\n` +
        '받은메일·보낸메일을 수집하며, 원본 날짜와 발신자·수신자를 표시합니다.\n' +
        '계정 인증은 관리자 Mac의 메일 연결 화면에서 진행합니다. 인증 전에는 메일이 수집되지 않습니다.\n\n' +
        '이 채널은 원본 메일함 기준입니다. 전달된 메일의 거래 회사는 원문을 확인해야 합니다. ' +
        '자동 회신을 견적 발송이나 판매 확정으로 처리하지 않습니다. 첨부파일 원본은 기존 메일함에서 확인하세요.',
      [['h', account.channel]]);
      store.set(key, JSON.stringify(event));
    }
    await relay.publish(event);
    const found = await relay.query({ kinds: [9], '#h': [account.channel], ids: [event.id], limit: 1 });
    if (found.length !== 1 || found[0].content !== event.content) throw new Error('Channel verification failed');
    console.log(`${account.name}: signed publish and read verified`);
  }
} finally { store.close(); }
