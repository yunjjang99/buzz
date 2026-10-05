const root = document.querySelector('#accounts');
const notice = document.querySelector('#notice');
const labels = { ready: '연결됨', waiting: '대기', collecting: '수집 중', backfill: '과거 메일 수집 중',
  watching: '새 메일 확인 중', retrying: '재시도 대기', attention: '확인 필요', paused: '일시 중지' };

async function post(path, payload) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mail-Sync': '1' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '요청 실패');
}
async function refresh() {
  const response = await fetch('/api/status');
  if (!response.ok) throw new Error('상태를 가져올 수 없습니다. 화면을 새로고침하세요.');
  const data = await response.json();
  const total = (data.routing || []).reduce((sum, row) => sum + row.posted, 0);
  document.querySelector('#classification-status').textContent = `${data.classification?.message || '자동 분류 준비 중'} · 분류 게시 ${total}건${data.classification?.remaining ? ` / 남은 ${data.classification.remaining}건` : ''}`;
  document.querySelector('#summary').textContent = `최초 수집 범위: ${data.since}부터 · Buzz: ${labels[data.relay.state] || '연결 준비 중'}${data.relay.message ? ` · ${data.relay.message}` : ''}`;
  for (const account of data.accounts) {
    let card = document.getElementById(`card-${account.id}`);
    if (!card) {
      card = document.createElement('article'); card.id = `card-${account.id}`;
      const title = document.createElement('h2'); title.textContent = `${account.company} · ${account.user}`; card.append(title);
      const channel = document.createElement('p'); channel.className = 'muted'; channel.textContent = `수집 채널: #${account.name}`; card.append(channel);
      const status = document.createElement('p'); status.className = 'status'; status.dataset.status = ''; card.append(status);
      const label = document.createElement('label'); label.htmlFor = `password-${account.id}`; label.textContent = '앱 비밀번호'; card.append(label);
      const input = document.createElement('input'); input.id = label.htmlFor; input.type = 'password'; input.autocomplete = 'new-password'; input.maxLength = 128; card.append(input);
      const connect = document.createElement('button'); connect.textContent = '연결 확인 후 수집 시작';
      connect.onclick = async () => {
        connect.disabled = true; notice.textContent = '메일 서버 로그인을 확인하고 있습니다…';
        try { await post('/api/connect', { account: account.id, password: input.value }); input.value = ''; notice.textContent = `${account.company} 연결 완료. 최근 3개월 메일 수집을 시작합니다.`; await refresh(); }
        catch (error) { notice.textContent = error.message; }
        finally { connect.disabled = false; }
      }; card.append(connect);
      const toggle = document.createElement('button'); toggle.className = 'secondary'; toggle.dataset.toggle = '';
      toggle.onclick = async () => {
        toggle.disabled = true;
        try { await post('/api/toggle', { account: account.id, enabled: toggle.dataset.enabled !== 'true' }); await refresh(); }
        catch (error) { notice.textContent = error.message; toggle.disabled = false; }
      }; card.append(toggle); root.append(card);
    }
    card.querySelector('[data-status]').textContent = `${account.configured ? labels[account.status.state] || '수집 대기' : '미연결 · 앱 비밀번호 입력 필요'} · 수집 ${account.collected}건 / Buzz 게시 ${account.delivered}건${account.limited ? ` / 일부 내용 제한 ${account.limited}건` : ''}${account.status.updated ? ` · 최근 확인 ${new Date(account.status.updated).toLocaleString('ko-KR')}` : ''}${account.status.message ? ` — ${account.status.message}` : ''}`;
    const toggle = card.querySelector('[data-toggle]'); toggle.disabled = !account.configured;
    toggle.dataset.enabled = String(account.enabled); toggle.textContent = account.enabled ? '수집 일시 중지' : '수집 재개';
  }
}
document.querySelector('#retry').onclick = async () => {
  try { await post('/api/retry', {}); await refresh(); notice.textContent = '연결 확인을 요청했습니다.'; }
  catch (error) { notice.textContent = error.message; }
};
refresh().catch((error) => { notice.textContent = error.message; });
setInterval(() => refresh().catch((error) => { notice.textContent = error.message; }), 15000);
