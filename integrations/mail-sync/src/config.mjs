export const accounts = [
  { id: 'kovar', company: '코바', user: 'nova@kovar.kr', host: 'imap.gmail.com',
    aliases: ['nova@kovar.kr', 'sales@kovar.kr'],
    channel: 'dfa0ae4b-d294-445c-8c79-84a8d563f5ef', name: '코바-07-메일연동' },
  { id: 'chungbook', company: '청북', user: 'cbtcshin@naver.com', host: 'imap.naver.com',
    aliases: ['cbtcshin@naver.com'],
    channel: '43b23081-a625-41e9-beb0-949214a08397', name: '청북-07-메일연동' },
];

// Calendar months in Korea, clamping e.g. May 31 to February's last day.
export function threeMonthsAgo(now = new Date()) {
  const local = new Date(now.getTime() + 9 * 3600_000);
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 3, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(local.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
}

export const origin = process.env.BUZZ_MAIL_RELAY_ORIGIN || 'https://buzz.kovar.kr';
export const internalOrigin = process.env.BUZZ_MAIL_RELAY_INTERNAL || origin;
export const maxSourceBytes = 8 * 1024 * 1024;
export const batchSize = 25;
