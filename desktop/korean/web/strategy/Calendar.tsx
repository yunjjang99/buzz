import { useState } from "react";
import { shiftDay, today, type Mail, type SavedTask } from "./model";

/** A month overview and day/week agenda share exactly the same confirmed task population. */
export function Calendar({
  tasks,
  onEdit,
  mails,
  onReview,
}: {
  tasks: SavedTask[];
  mails: Mail[];
  onReview(mail: Mail): void;
  onEdit(task: SavedTask): void;
}) {
  const [day, setDay] = useState(today());
  const [mode, setMode] = useState("일");
  const first = `${day.slice(0, 7)}-01`;
  const offset = new Date(`${first}T00:00:00Z`).getUTCDay();
  const days = Array.from({ length: 42 }, (_, i) =>
    shiftDay(first, i - offset),
  );
  const active = tasks.filter((t) => t.state !== "취소");
  const shown = active.filter((task) =>
    mode === "주"
      ? task.date >= day && task.date <= shiftDay(day, 6)
      : task.date === day,
  );
  const registered = new Set(tasks.map((t) => t.source));
  const candidates = mails
    .filter((m) => !registered.has(m.id))
    .flatMap((mail) => mail.candidates.map((date) => ({ mail, date })));
  const proposed = candidates
    .filter((c) =>
      mode === "주"
        ? c.date >= day && c.date <= shiftDay(day, 6)
        : c.date === day,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  function changeMonth(n: number) {
    const d = new Date(`${first}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setDay(d.toISOString().slice(0, 10));
  }
  return (
    <section
      className="strategy-panel strategy-calendar"
      aria-label="업무 캘린더"
    >
      <header>
        <h2>업무 캘린더</h2>
        <div className="strategy-controls">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            aria-label="이전 달"
          >
            ‹
          </button>
          <strong>{day.slice(0, 7).replace("-", ". ")}</strong>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            aria-label="다음 달"
          >
            ›
          </button>
          <button type="button" onClick={() => setDay(today())}>
            오늘
          </button>
        </div>
      </header>
      <p>
        메일의 명시적 날짜는 ‘확인 필요’ 후보로 표시됩니다. 확정된 업무와 구분해
        검토하세요.
      </p>
      <div className="calendar-weekdays" aria-hidden="true">
        {"일월화수목금토".split("").map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {days.map((date) => {
          const list = active.filter((t) => t.date === date);
          const suggestions = candidates.filter((c) => c.date === date).length;
          return (
            <button
              type="button"
              key={date}
              className={`${date === day ? "selected" : ""} ${date.slice(0, 7) !== day.slice(0, 7) ? "outside" : ""}`}
              aria-pressed={date === day}
              aria-label={`${date} 업무 ${list.length}건 · 확인 필요 ${suggestions}건`}
              onClick={() => setDay(date)}
            >
              <span className={date === today() ? "today" : ""}>
                {Number(date.slice(-2))}
              </span>
              {list.length > 0 && <small>{list.length}건</small>}
              {suggestions > 0 && (
                <small className="calendar-candidate">확인 {suggestions}</small>
              )}
            </button>
          );
        })}
      </div>
      <header className="agenda-heading">
        <h3>
          {day}
          {mode === "주" ? ` ~ ${shiftDay(day, 6)}` : " 일정"}
        </h3>
        <div className="strategy-controls">
          {["일", "주"].map((m) => (
            <button
              type="button"
              key={m}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </header>
      <div className="strategy-agenda">
        {!shown.length && !proposed.length && (
          <p className="strategy-empty">
            등록된 일정이 없습니다. 메일을 검토하거나 업무를 직접 등록하세요.
          </p>
        )}
        {shown.map((task) => (
          <button
            type="button"
            className="agenda-item"
            key={`${task.author}:${task.id}`}
            onClick={() => onEdit(task)}
          >
            <time>
              {mode === "주" && <small>{task.date.slice(5)} </small>}
              {task.time || "시간 미정"}
            </time>
            <span>
              <strong>{task.title}</strong>
              <small>
                {task.category} · {task.product || "물품 미입력"} ·{" "}
                {task.owner || "담당 미지정"}
              </small>
            </span>
            <em>{task.state}</em>
          </button>
        ))}
        {proposed.map(({ mail, date }) => (
          <button
            type="button"
            className="agenda-item candidate-item"
            key={`${mail.id}:${date}`}
            onClick={() => onReview(mail)}
          >
            <time>{mode === "주" ? date.slice(5) : "시간 미정"}</time>
            <span>
              <strong>{mail.subject}</strong>
              <small>메일에서 추출 · 원문 확인 후 업무로 등록</small>
            </span>
            <em>확인 필요</em>
          </button>
        ))}
      </div>
    </section>
  );
}
