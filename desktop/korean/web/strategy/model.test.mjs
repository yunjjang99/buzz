import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classify,
  COLLECTOR,
  MAIL_CHANNEL,
  TASK_TAG,
  parseMail,
  compareMonths,
  foldTasks,
  taskContent,
  validDate,
  today,
} from "./model.ts";
import { readHistory } from "./data.ts";
const mail = (content, extras = {}) => ({
  id: "a".repeat(64),
  kind: 9,
  pubkey: COLLECTOR,
  created_at: 1791200000,
  tags: [["h", MAIL_CHANNEL]],
  content,
  ...extras,
});
const body =
  "**[코바 메일 · 수신] 베어링 통관 서류 요청**\n메일함: test / inbox\n메일 날짜: 2026. 9. 30. 오후 3:00:00 (한국 시간)\n보낸 사람: supplier@example.test\n[원본 메일함에서 확인](https://mail.google.com/mail/u/test/#search/id)\n\n> 아래는 원본 이메일 내용입니다.\n> 서류 마감 2026-10-05\n> 주문번호 2026-09-10\n> ETA 2026-02-30";
test("collector source, channel, original date and scheduling evidence are enforced", () => {
  const result = parseMail(mail(body));
  assert.equal(result.date, "2026-09-30");
  assert.equal(result.category, "통관");
  assert.deepEqual(result.candidates, ["2026-10-05"]);
  assert.equal(parseMail(mail(body, { pubkey: "other" })), null);
  assert.equal(parseMail(mail(body, { tags: [["h", "other"]] })), null);
  assert.equal(
    parseMail(mail(body.replace("2026. 9. 30.", "unknown"))).date,
    null,
  );
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(today(new Date("2026-10-04T16:00:00Z")), "2026-10-05");
});
test("monthly count uses equal elapsed days and received mails, never ingestion date", () => {
  const base = parseMail(mail(body));
  const result = compareMonths(
    [
      { ...base, date: "2026-10-05" },
      { ...base, date: "2026-10-06" },
      { ...base, date: "2026-09-05" },
      { ...base, date: "2026-09-06" },
      { ...base, date: "2026-10-05", direction: "발신" },
      { ...base, date: null },
    ],
    "2026-10-05",
  );
  assert.deepEqual(
    result.rows.find((r) => r.category === "통관"),
    { category: "통관", current: 1, previous: 1 },
  );
  assert.equal(compareMonths([], "2026-03-31").end, "2026-03-28");
});
const task = {
  id: "task-1",
  title: "서류 제출",
  date: "2026-10-05",
  time: "15:00",
  category: "통관",
  product: "6205 · 200개",
  owner: "담당",
  state: "예정",
  source: "",
  note: "",
  revision: 1,
};
const event = (t, author, id = "b") =>
  mail(taskContent(t), {
    pubkey: author,
    id: id.repeat(64),
    tags: [
      ["h", MAIL_CHANNEL],
      ["t", TASK_TAG],
    ],
  });
test("complete snapshots survive out-of-order delivery and cannot cross author boundaries", () => {
  const rows = foldTasks([
    event({ ...task, revision: 2, state: "완료" }, "alice", "c"),
    event(task, "alice"),
    event({ ...task, revision: 9 }, "bob"),
  ]);
  assert.equal(rows.find((t) => t.author === "alice").state, "완료");
  assert.equal(rows.length, 2);
  assert.throws(() => taskContent({ ...task, time: "25:00" }));
  assert.throws(() => taskContent({ ...task, date: "2026-02-30" }));
  assert.equal(
    foldTasks([
      mail("bad JSON", {
        tags: [
          ["h", MAIL_CHANNEL],
          ["t", TASK_TAG],
        ],
      }),
    ]).length,
    0,
  );
});
test("history overlaps equal timestamps, deduplicates, and discloses saturation", async () => {
  const first = Array.from({ length: 250 }, (_, i) =>
    mail("", { id: String(i), created_at: i < 240 ? 100 : 90 }),
  );
  const filters = [];
  const result = await readHistory({
    query: async (f) => {
      filters.push(f);
      return filters.length === 1
        ? first
        : [...first.slice(240), mail("", { id: "old", created_at: 80 })];
    },
  });
  assert.equal(filters[1].until, 90);
  assert.equal(result.events.length, 251);
  assert.equal(result.limited, false);
  const capped = await readHistory({
    query: async () => first.map((e) => ({ ...e, created_at: 90 })),
  });
  assert.equal(capped.limited, true);
  await assert.rejects(
    readHistory({
      query: async () => {
        throw new Error("denied");
      },
    }),
    /denied/,
  );
});

test("multiline collector subjects retain the mail instead of dropping it", () => {
  assert.equal(
    parseMail(mail(body.replace("베어링 통관 서류 요청", "새로운\n견적 요청")))
      .subject,
    "새로운 견적 요청",
  );
});

test("auto acknowledgements are not classified as requests; self-addressed website requests count as received", () => {
  assert.equal(classify("[견적요청 접수] INQ-123", "발신"), "기타");
  const m = {
    ...parseMail(mail(body)),
    date: "2026-10-05",
    direction: "수신·발신",
  };
  assert.equal(
    compareMonths([m], "2026-10-05").rows.find((r) => r.category === "통관")
      .current,
    1,
  );
});
