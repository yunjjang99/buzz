import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import ts from "typescript";
import { desktopRoot, transformSource } from "../overlay.mjs";
import { setLocale, t } from "./locale.ts";
import { translateWaveFallback } from "./interaction-copy.ts";

afterEach(() => setLocale("ko"));

async function loadTransformed(relative) {
  const filename = path.join(desktopRoot, "src", relative);
  let source = transformSource(readFileSync(filename, "utf8"), filename);
  for (const module of ["locale", "interaction-copy"]) {
    source = source.replaceAll(
      `"@buzz-korean/${module}"`,
      JSON.stringify(new URL(`./${module}.ts`, import.meta.url).href),
    );
  }
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
  );
}

test("production date helpers resolve Korean and English after import", async () => {
  const dates = await loadTransformed("shared/lib/datetime.ts");
  const time = await loadTransformed("features/messages/lib/dateFormatters.ts");
  const now = new Date(2026, 9, 5, 14, 30).getTime() / 1000;
  const yesterday = new Date(2026, 9, 4, 9, 5).getTime() / 1000;
  setLocale("ko");
  assert.equal(dates.formatDayGroupLabel(now, now), "오늘");
  assert.equal(dates.formatDayGroupLabel(yesterday, now), "어제");
  assert.equal(
    dates.formatItemTimestamp(yesterday, { nowSeconds: now, withTime: true }),
    "어제 오전 9:05",
  );
  assert.equal(time.formatTime(now), "오후 2:30");
  assert.equal(time.formatTimeWithoutDayPeriod(time.formatTime(now)), "2:30");
  setLocale("en");
  assert.equal(dates.formatDayGroupLabel(now, now), "Today");
  assert.equal(
    dates.formatItemTimestamp(yesterday, { nowSeconds: now, withTime: true }),
    "Yesterday at 9:05 AM",
  );
  assert.equal(time.formatTime(now), "2:30 PM");
});

test("wave display preserves names, custom fallback content and English round trips", () => {
  const original = "Profile {name} waved at you.";
  setLocale("ko");
  assert.equal(
    translateWaveFallback(original),
    "Profile {name} 님이 손을 흔들었습니다.",
  );
  assert.equal(
    translateWaveFallback("custom fallback — waved at you?"),
    "custom fallback — waved at you?",
  );
  setLocale("en");
  assert.equal(translateWaveFallback(original), original);
});

test("every interaction translation preserves its interpolation parameters", () => {
  const messages = JSON.parse(
    readFileSync(
      new URL("./interaction-messages.json", import.meta.url),
      "utf8",
    ),
  );
  const parameters = (value) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  setLocale("ko");
  for (const [english, korean] of Object.entries(messages)) {
    assert.deepEqual(parameters(english), parameters(korean), english);
    // Check the real merged dictionary, where an older general entry could win.
    assert.equal(t(english), korean, english);
  }
});
