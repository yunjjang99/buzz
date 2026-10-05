import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  categories,
  states,
  today,
  type Mail,
  type SavedTask,
  type Task,
} from "./model";

/** Editing always commits a complete snapshot; extracted dates remain a suggestion until saved. */
export function TaskEditor({
  mail,
  task,
  name,
  onSave,
  onClose,
}: {
  mail?: Mail;
  task?: SavedTask;
  name: string;
  onSave(task: Task): Promise<void>;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [value, setValue] = useState<Task>(() =>
    task
      ? { ...task, revision: task.revision + 1 }
      : {
          id: crypto.randomUUID(),
          title: mail?.subject ?? "",
          date: mail?.candidates.length === 1 ? mail.candidates[0] : today(),
          time: "",
          category: mail?.category ?? "기타",
          product: "",
          owner: name,
          state: "예정",
          source: mail?.id ?? "",
          note: "",
          revision: 1,
        },
  );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave(value);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="strategy-editor"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      aria-labelledby="editor-title"
    >
      <form onSubmit={submit}>
        <header>
          <h2 id="editor-title">{task ? "업무 수정" : "업무 등록"}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="닫기"
          >
            ×
          </button>
        </header>
        <p>
          코바 메일연동 채널에 업무 기록이 저장됩니다. 작성자가 수정하며 채널
          구성원이 함께 열람합니다.
        </p>
        {mail && (
          <p className="strategy-notice">
            메일에서 제안한 내용입니다. 실제 마감·입고 날짜와 물품을 원문에서
            확인하세요.
          </p>
        )}
        <label>
          할 일
          <input
            required
            maxLength={300}
            value={value.title}
            onChange={(e) => setValue({ ...value, title: e.target.value })}
          />
        </label>
        <div className="editor-grid">
          <label>
            날짜
            <input
              type="date"
              required
              value={value.date}
              onChange={(e) => setValue({ ...value, date: e.target.value })}
            />
          </label>
          <label>
            시간 (한국 시간 · 선택)
            <input
              type="time"
              value={value.time}
              onChange={(e) => setValue({ ...value, time: e.target.value })}
            />
          </label>
        </div>
        <div className="editor-grid">
          <label>
            업무 유형
            <select
              value={value.category}
              onChange={(e) =>
                setValue({
                  ...value,
                  category: e.target.value as Task["category"],
                })
              }
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            진행 상태
            <select
              value={value.state}
              onChange={(e) =>
                setValue({ ...value, state: e.target.value as Task["state"] })
              }
            >
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          물품 · 수량
          <input
            maxLength={1000}
            placeholder="예: 6205 베어링 · 200개"
            value={value.product}
            onChange={(e) => setValue({ ...value, product: e.target.value })}
          />
        </label>
        <label>
          담당자
          <input
            maxLength={1000}
            value={value.owner}
            onChange={(e) => setValue({ ...value, owner: e.target.value })}
          />
        </label>
        <label>
          메모
          <textarea
            maxLength={1000}
            rows={3}
            value={value.note}
            onChange={(e) => setValue({ ...value, note: e.target.value })}
          />
        </label>
        {mail && (
          <a href={mail.url} target="_blank" rel="noreferrer">
            원본 메일 확인 ↗
          </a>
        )}
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={onClose} disabled={busy}>
            닫기
          </button>
          <button type="submit" className="strategy-primary" disabled={busy}>
            {busy ? "저장 확인 중…" : "업무 저장"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
