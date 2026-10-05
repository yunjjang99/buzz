import type { Event } from "nostr-tools/pure";

export const MAIL_CHANNEL = "dfa0ae4b-d294-445c-8c79-84a8d563f5ef";
export const COLLECTOR =
  "00284d6c00f43437cc492cf574ff95f0637e9517c7804fc11fdce2ced5d055f1";
export const TASK_TAG = "buzz-strategy-v1";
export const categories = [
  "견적요청",
  "견적발송",
  "공급처오퍼",
  "발주",
  "통관",
  "배송·입고",
  "기타",
] as const;
export type Category = (typeof categories)[number];
export const states = ["예정", "진행 중", "완료", "취소"] as const;
export type TaskState = (typeof states)[number];
export type Mail = {
  id: string;
  subject: string;
  date: string | null;
  direction: string;
  from: string;
  body: string;
  category: Category;
  url: string;
  limited: boolean;
  candidates: string[];
};
export type Task = {
  id: string;
  title: string;
  date: string;
  time: string;
  category: Category;
  product: string;
  owner: string;
  state: TaskState;
  source: string;
  note: string;
  revision: number;
};
export type SavedTask = Task & {
  author: string;
  eventId: string;
  createdAt: number;
};
export const getTag = (event: Event, name: string) =>
  event.tags.find((t) => t[0] === name)?.[1] ?? "";
const unescapeMail = (s: string) => s.replace(/\\([\\`*_{}[\]<>#])/g, "$1");

/** All calendar dates and reporting cutoffs use Korea time, independent of device zone. */
export function today(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(stamp) &&
    new Date(stamp).toISOString().slice(0, 10) === value
  );
}
export function shiftDay(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function classify(subject: string, direction: string): Category {
  if (/자동|접수|auto.?reply|received your/i.test(subject)) return "기타";
  if (/통관|customs|수입신고|관세/i.test(subject)) return "통관";
  if (/배송|입고|출고|납기|shipment|delivery|fedex|dhl|tracking/i.test(subject))
    return "배송·입고";
  if (/견적.*요청|견적.*문의|rfq|inquiry|quotation request/i.test(subject))
    return "견적요청";

  if (/발주|purchase order|\bPO[ -]/i.test(subject)) return "발주";
  if (/offer|오퍼|stock list|재고리스트/i.test(subject)) return "공급처오퍼";
  if (/견적|quotation|quote/i.test(subject))
    return direction === "발신" ? "견적발송" : "견적요청";
  return "기타";
}

/** Read only the installed collector's signed mail format; never use ingestion time as mail date. */
export function parseMail(event: Event): Mail | null {
  if (
    event.kind !== 9 ||
    event.pubkey !== COLLECTOR ||
    getTag(event, "h") !== MAIL_CHANNEL
  )
    return null;
  const text = event.content;
  const heading = /^\*\*\[코바 메일 · ([^\]]+)\] ([\s\S]*?)\*\*\n메일함:/.exec(
    text,
  );
  if (!heading) return null;
  const metadata = text
    .slice(heading[0].length)
    .split("> 아래는 원본 이메일 내용입니다.")[0];
  const rawDate = /^메일 날짜: (\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./m.exec(
    metadata,
  );
  const date = rawDate
    ? `${rawDate[1]}-${rawDate[2].padStart(2, "0")}-${rawDate[3].padStart(2, "0")}`
    : "";
  const body = unescapeMail(
    text
      .split("> 아래는 원본 이메일 내용입니다.")[1]
      ?.replace(/^> ?/gm, "")
      .trim() ?? "",
  );
  const url =
    /\[원본 메일함에서 확인\]\((https:\/\/mail\.google\.com\/[^\s]+)\)/.exec(
      text,
    )?.[1] ?? "https://mail.google.com/";
  // Only explicit, complete dates near scheduling words become suggestions. They still require confirmation.
  const candidates = [
    ...new Set(
      body
        .split("\n")
        .filter((line) =>
          /기한|마감|까지|입항|입고|배송|통관|due|ETA|delivery|deadline/i.test(
            line,
          ),
        )
        .flatMap((line) =>
          [...line.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)].map(
            (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
          ),
        )
        .filter(validDate),
    ),
  ].slice(0, 10);
  return {
    id: event.id,
    subject:
      unescapeMail(heading[2]).replace(/\s+/g, " ").trim() || "(제목 없음)",
    direction: heading[1],
    date: validDate(date) ? date : null,
    from: unescapeMail(/^보낸 사람: (.*)$/m.exec(metadata)?.[1] ?? ""),
    body,
    category: classify(
      unescapeMail(heading[2]).replace(/\s+/g, " "),
      heading[1],
    ),
    url,
    limited: metadata.includes("수집 범위 안내:"),
    candidates,
  };
}

/** Strictly validate a complete task snapshot before accepting or signing it. */
export function validateTask(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;
  const t = value as Task;
  return (
    typeof t.id === "string" &&
    /^[a-zA-Z0-9-]{1,80}$/.test(t.id) &&
    typeof t.title === "string" &&
    t.title.trim().length > 0 &&
    t.title.length <= 300 &&
    validDate(t.date) &&
    typeof t.time === "string" &&
    /^(?:|(?:[01]\d|2[0-3]):[0-5]\d)$/.test(t.time) &&
    categories.includes(t.category) &&
    states.includes(t.state) &&
    [t.product, t.owner, t.note].every(
      (s) => typeof s === "string" && s.length <= 1000,
    ) &&
    typeof t.source === "string" &&
    /^(?:|[a-f0-9]{64})$/.test(t.source) &&
    Number.isSafeInteger(t.revision) &&
    t.revision >= 1 &&
    t.revision < 1000000
  );
}
export function taskContent(task: Task) {
  if (!validateTask(task)) throw new Error("업무 제목·날짜·시간을 확인하세요.");
  return `전략실 업무 · ${task.title}\n${task.date} ${task.time || "시간 미정"} · ${task.state}\n\n[BUZZ_STRATEGY_V1]\n${JSON.stringify(task)}`;
}
/** Each author owns their task; another member cannot replace their record by reusing its ID. */
export function foldTasks(events: Event[]): SavedTask[] {
  const tasks = new Map<string, SavedTask>();
  for (const event of events) {
    if (
      event.kind !== 9 ||
      getTag(event, "h") !== MAIL_CHANNEL ||
      getTag(event, "t") !== TASK_TAG
    )
      continue;
    let task: unknown;
    try {
      task = JSON.parse(event.content.split("\n[BUZZ_STRATEGY_V1]\n")[1] ?? "");
    } catch {
      continue;
    }
    if (!validateTask(task)) continue;
    const key = `${event.pubkey}:${task.id}`;
    const previous = tasks.get(key);
    if (
      !previous ||
      task.revision > previous.revision ||
      (task.revision === previous.revision &&
        (event.created_at > previous.createdAt ||
          (event.created_at === previous.createdAt &&
            event.id < previous.eventId)))
    ) {
      tasks.set(key, {
        ...task,
        author: event.pubkey,
        eventId: event.id,
        createdAt: event.created_at,
      });
    }
  }
  return [...tasks.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.time.localeCompare(b.time) ||
      a.title.localeCompare(b.title),
  );
}
/** Compare matching elapsed days; counts describe subject-classified inbound mails, not unique deals. */
export function compareMonths(mails: Mail[], day: string) {
  const [year, month, elapsed] = day.split("-").map(Number);
  const priorStart = new Date(Date.UTC(year, month - 2, 1))
    .toISOString()
    .slice(0, 7);
  const priorLast = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const cutoff = Math.min(elapsed, priorLast);
  const end = `${day.slice(0, 7)}-${String(cutoff).padStart(2, "0")}`;
  const priorEnd = `${priorStart}-${String(cutoff).padStart(2, "0")}`;
  const inbound = mails.filter((m) => m.direction.includes("수신") && m.date);
  return {
    start: `${day.slice(0, 7)}-01`,
    end,
    priorStart: `${priorStart}-01`,
    priorEnd,
    rows: categories.map((category) => ({
      category,
      current: inbound.filter(
        (m) =>
          m.category === category &&
          (m.date ?? "") >= `${day.slice(0, 7)}-01` &&
          (m.date ?? "") <= end,
      ).length,
      previous: inbound.filter(
        (m) =>
          m.category === category &&
          (m.date ?? "") >= `${priorStart}-01` &&
          (m.date ?? "") <= priorEnd,
      ).length,
    })),
  };
}
