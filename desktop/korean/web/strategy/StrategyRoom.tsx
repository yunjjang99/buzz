import { useMemo, useState } from "react";
import { AccountPanel } from "../AccountPanel";
import type { WebAccount } from "../login-api";
import { Calendar } from "./Calendar";
import { TaskEditor } from "./TaskEditor";
import {
  categories,
  compareMonths,
  foldTasks,
  parseMail,
  today,
  type Mail,
  type SavedTask,
} from "./model";
import type { Signer } from "../signer";
import { useStrategy } from "./useStrategy";
import "./strategy.css";

/** Shared strategy view; each host supplies its existing account and signer. */
export function Room({
  account,
  onLogout,
  onBack,
  signerFactory,
  embedded = false,
}: {
  account: WebAccount;
  embedded?: boolean;
  onLogout?(): Promise<void>;
  onBack?(): void;
  signerFactory?: (account: WebAccount) => Signer;
}) {
  const data = useStrategy(account, signerFactory);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("전체");
  const [editor, setEditor] = useState<{
    mail?: Mail;
    task?: SavedTask;
  } | null>(null);
  const [detail, setDetail] = useState<Mail | null>(null);
  const [message, setMessage] = useState("");
  const [candidatesOnly, setCandidatesOnly] = useState(false);
  const [count, setCount] = useState(20);
  const [panel, setPanel] = useState(false);
  const mails = useMemo(
    () =>
      data.events
        .map(parseMail)
        .filter((m): m is Mail => m !== null)
        .sort(
          (a, b) =>
            (b.date ?? "").localeCompare(a.date ?? "") ||
            a.id.localeCompare(b.id),
        ),
    [data.events],
  );
  const tasks = useMemo(() => foldTasks(data.events), [data.events]);
  const day = today();
  const active = tasks.filter((t) => t.state !== "완료" && t.state !== "취소");
  const overdue = active.filter((t) => t.date < day);
  const mailMap = new Map(mails.map((m) => [m.id, m]));
  const reviewed = new Set(tasks.map((t) => t.source));
  const comparison = compareMonths(mails, day);
  const max = Math.max(
    1,
    ...comparison.rows.flatMap((r) => [r.current, r.previous]),
  );
  const filtered = mails.filter(
    (m) =>
      (!candidatesOnly || (m.candidates.length > 0 && !reviewed.has(m.id))) &&
      (category === "전체" || category === m.category) &&
      `${m.subject} ${m.from}`.toLowerCase().includes(query.toLowerCase()),
  );
  function openTask(task: SavedTask) {
    if (task.author !== account.pubkey) {
      setMessage(
        `작성자만 수정할 수 있습니다. ${task.title} · 담당: ${task.owner || "미지정"} · ${task.note || "메모 없음"}`,
      );
      return;
    }
    setEditor({ task, mail: mailMap.get(task.source) });
  }
  return (
    <div className={`strategy-shell ${embedded ? "strategy-embedded" : ""}`}>
      {!embedded && (
        <header className="strategy-top">
          {onBack ? (
            <button type="button" className="strategy-brand" onClick={onBack}>
              ✦ Buzz · 채널로 돌아가기
            </button>
          ) : (
            <a href="/chat/" className="strategy-brand">
              ✦ Buzz
            </a>
          )}
          <nav aria-label="주 메뉴">
            {onBack ? (
              <span aria-current="page">전략실</span>
            ) : (
              <>
                <a href="/chat/">채널</a>
                <a href="/chat/strategy.html" aria-current="page">
                  전략실
                </a>
              </>
            )}
          </nav>
          <span>{account.name}</span>
          {onLogout && (
            <>
              <button type="button" onClick={() => setPanel(true)}>
                계정
              </button>
              <button
                type="button"
                onClick={() => {
                  void onLogout().catch(() =>
                    setMessage("로그아웃하지 못했습니다. 다시 시도하세요."),
                  );
                }}
              >
                로그아웃
              </button>
            </>
          )}
        </header>
      )}
      <main className="strategy-main">
        <div className="strategy-title">
          <div>
            <h1>코바 전략실</h1>
            <p>
              {day} · 한국 시간 ·{" "}
              {data.updated
                ? `마지막 조회 ${new Date(data.updated).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })}`
                : "연결 확인 중"}
            </p>
          </div>
          <div className="strategy-controls">
            <button
              type="button"
              onClick={data.refresh}
              disabled={data.loading || data.saving}
            >
              새로고침
            </button>
            <button
              type="button"
              className="strategy-primary"
              onClick={() => setEditor({})}
              disabled={
                data.loading || Boolean(data.retry) || Boolean(data.error)
              }
            >
              + 업무 등록
            </button>
          </div>
        </div>
        {data.error && (
          <p role="alert" className="strategy-error">
            {data.error}
          </p>
        )}
        {message && (
          <div role="status" className="strategy-notice">
            {message}{" "}
            <button type="button" onClick={() => setMessage("")}>
              닫기
            </button>
          </div>
        )}
        {data.retry && (
          <div className="strategy-notice">
            아직 저장 확인을 받지 못한 업무가 있습니다.{" "}
            <button
              type="button"
              onClick={() => {
                void data.retrySave().catch(() => {});
              }}
              disabled={data.saving || data.loading}
            >
              저장 재시도
            </button>
          </div>
        )}
        <p className="strategy-coverage" role="status">
          {data.loading
            ? "메일과 업무 기록을 불러오는 중…"
            : `수집된 코바 메일 ${mails.length.toLocaleString()}건 · 날짜 미확인 ${mails.filter((m) => !m.date).length}건 · 본문 제한 ${mails.filter((m) => m.limited).length}건`}
          . 과거 메일 수집이 진행 중일 수 있어 집계는 잠정치입니다.
          {data.limited &&
            " 조회 한도에 도달했습니다. 전체 기간 집계가 아닙니다."}
        </p>
        {!data.loading && !data.error && (
          <>
            <section className="strategy-kpis" aria-label="업무 요약">
              {[
                [
                  "오늘 할 일",
                  active.filter((t) => t.date === day).length,
                  "등록된 미완료 업무",
                ],
                ["기한 지난 업무", overdue.length, "이전 날짜의 미완료 업무"],
                [
                  "예정 물류 업무",
                  active.filter((t) =>
                    ["통관", "배송·입고"].includes(t.category),
                  ).length,
                  "등록된 통관·배송·입고",
                ],
                [
                  "일정 검토 후보",
                  mails.filter(
                    (m) => m.candidates.length && !reviewed.has(m.id),
                  ).length,
                  "명시적 날짜가 있는 미등록 메일",
                ],
              ].map(([label, value, caption], i) => (
                <article
                  key={label}
                  className={i === 1 && Number(value) > 0 ? "attention" : ""}
                >
                  <h2>{label}</h2>
                  <strong>
                    {data.loading ? "—" : value}
                    <small>건</small>
                  </strong>
                  <p>{caption}</p>
                </article>
              ))}
            </section>
            <div className="strategy-columns">
              <Calendar
                tasks={tasks}
                mails={mails}
                onEdit={openTask}
                onReview={(mail) => setEditor({ mail })}
              />
              <div className="strategy-side">
                <section className="strategy-panel">
                  <header>
                    <h2>먼저 처리할 업무</h2>
                    <span>{active.length}건</span>
                  </header>
                  {!active.length && (
                    <p className="strategy-empty">
                      아직 등록된 업무가 없습니다. 아래 메일에서 ‘업무로 등록’을
                      눌러 기한을 확인하세요.
                    </p>
                  )}
                  <div className="strategy-task-list">
                    {active.slice(0, 20).map((t) => (
                      <button
                        type="button"
                        key={`${t.author}:${t.id}`}
                        onClick={() => openTask(t)}
                      >
                        <span
                          className={t.date < day ? "strategy-overdue" : ""}
                        >
                          {t.date} {t.time}
                        </span>
                        <strong>{t.title}</strong>
                        <small>
                          {t.owner || "담당 미지정"} · {t.state}
                        </small>
                      </button>
                    ))}
                  </div>
                  {active.length > 20 && (
                    <p>가까운 기한 20건 표시 · 전체 일정은 캘린더에서 확인</p>
                  )}
                </section>
                <section className="strategy-panel">
                  <header>
                    <h2>통관 · 입고 현황</h2>
                  </header>
                  <p>
                    등록한 예정·진행 상태입니다. 운송사 실시간 조회는 연결되지
                    않았습니다.
                  </p>
                  <div className="strategy-task-list">
                    {tasks
                      .filter(
                        (t) =>
                          ["통관", "배송·입고"].includes(t.category) &&
                          t.state !== "취소",
                      )
                      .slice(-20)
                      .map((t) => (
                        <button
                          type="button"
                          key={`${t.author}:${t.id}`}
                          onClick={() => openTask(t)}
                        >
                          <span>
                            {t.date} · {t.category} · {t.state}
                          </span>
                          <strong>{t.product || t.title}</strong>
                          <small>{t.owner || "담당 미지정"}</small>
                        </button>
                      ))}
                  </div>
                  {!tasks.some(
                    (t) =>
                      ["통관", "배송·입고"].includes(t.category) &&
                      t.state !== "취소",
                  ) && (
                    <p className="strategy-empty">
                      확인해 등록한 통관·입고 일정이 없습니다.
                    </p>
                  )}
                </section>
              </div>
            </div>
            <section className="strategy-panel strategy-trends">
              <header>
                <h2>이번 달 · 지난달 요청 관련 메일 비교</h2>
                <span>잠정 집계</span>
              </header>
              <p>
                제목 규칙으로 분류한 수신 메일 수입니다. 고유 요청·거래 건수가
                아닙니다. 증가·감소만으로 성과를 판단하지 않습니다.
              </p>
              <p className="strategy-legend">
                <i />
                {comparison.start} ~ {comparison.end} <i />
                {comparison.priorStart} ~ {comparison.priorEnd} · 동일 일수
              </p>
              <div className="comparison-grid">
                {comparison.rows
                  .filter((r) => r.category !== "견적발송")
                  .map((r) => (
                    <div className="comparison-row" key={r.category}>
                      <strong>{r.category}</strong>
                      <div>
                        <div className="comparison-track">
                          <span
                            style={{ width: `${(r.current / max) * 100}%` }}
                          />
                        </div>
                        <div className="comparison-track previous">
                          <span
                            style={{ width: `${(r.previous / max) * 100}%` }}
                          />
                        </div>
                      </div>
                      <span>
                        {r.current} / {r.previous}건<br />
                        <small>
                          {r.previous === 0
                            ? r.current
                              ? "전월 0건"
                              : "변화 없음"
                            : `${r.current - r.previous > 0 ? "+" : ""}${Math.round(((r.current - r.previous) / r.previous) * 100)}%`}
                        </small>
                      </span>
                    </div>
                  ))}
              </div>
              <p>
                응답 시간·수주율·지연율은 요청과 처리 결과 연결이 필요하여 아직
                산출하지 않습니다.
              </p>
            </section>
            <section className="strategy-panel">
              <header>
                <h2>메일 검토 · 업무 등록</h2>
                <span>{filtered.length}건</span>
              </header>
              <div className="strategy-filters">
                <label>
                  일정 후보만
                  <input
                    type="checkbox"
                    checked={candidatesOnly}
                    onChange={(e) => {
                      setCandidatesOnly(e.target.checked);
                      setCount(20);
                    }}
                  />
                </label>
                <label>
                  검색
                  <input
                    type="search"
                    placeholder="제목 또는 보낸 사람"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setCount(20);
                    }}
                  />
                </label>
                <label>
                  메일 분류
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setCount(20);
                    }}
                  >
                    <option>전체</option>
                    {categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mail-table">
                <table>
                  <thead>
                    <tr>
                      <th>메일 날짜</th>
                      <th>분류 · 방향</th>
                      <th>제목 / 보낸 사람</th>
                      <th>검토</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, count).map((m) => (
                      <tr key={m.id}>
                        <td>{m.date ?? "확인 필요"}</td>
                        <td>
                          <span className="strategy-tag">{m.category}</span>
                          <small>{m.direction}</small>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="mail-subject"
                            onClick={() =>
                              setDetail(detail?.id === m.id ? null : m)
                            }
                          >
                            {m.subject}
                          </button>
                          <small>{m.from}</small>
                          {m.candidates.length > 0 && (
                            <small className="strategy-overdue">
                              일정 후보: {m.candidates.join(", ")} · 확인 필요
                            </small>
                          )}
                          {m.limited && (
                            <small>본문 일부 제한 · 첨부 내용 미분석</small>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => setEditor({ mail: m })}
                            disabled={
                              data.loading ||
                              Boolean(data.retry) ||
                              Boolean(data.error)
                            }
                          >
                            {reviewed.has(m.id) ? "추가 업무" : "업무로 등록"}
                          </button>
                          <a href={m.url} target="_blank" rel="noreferrer">
                            원본 ↗
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!filtered.length && (
                <p className="strategy-empty">
                  조건에 맞는 수집 메일이 없습니다. 조회 오류가 있다면 먼저 다시
                  연결하세요.
                </p>
              )}
              {filtered.length > count && (
                <button type="button" onClick={() => setCount((c) => c + 20)}>
                  메일 20건 더 보기
                </button>
              )}
              {detail && (
                <aside className="strategy-mail-detail" aria-label="메일 본문">
                  <header>
                    <h3>{detail.subject}</h3>
                    <button type="button" onClick={() => setDetail(null)}>
                      본문 닫기
                    </button>
                  </header>
                  <pre>
                    {detail.body || "본문이 없습니다. 원본 메일을 확인하세요."}
                  </pre>
                </aside>
              )}
            </section>
          </>
        )}
      </main>
      {editor && (
        <TaskEditor
          {...editor}
          name={account.name}
          onClose={() => setEditor(null)}
          onSave={data.save}
        />
      )}
      {panel && (
        <AccountPanel
          account={account}
          onChange={() => location.reload()}
          onClose={() => setPanel(false)}
        />
      )}
    </div>
  );
}
