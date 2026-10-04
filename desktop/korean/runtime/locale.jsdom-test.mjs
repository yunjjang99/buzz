import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  getLocale,
  LOCALE_STORAGE_KEY,
  resolveLocale,
  setLocale,
  t,
  useLocale,
} from "./locale.ts";

afterEach(() => {
  cleanup();
  setLocale("en");
});

function Menu() {
  useLocale();
  return React.createElement("button", { type: "button" }, t("Send message"));
}

test("language changes update mounted UI, save the choice, and preserve parameters", () => {
  setLocale("ko");
  render(React.createElement(Menu));
  assert.ok(screen.getByRole("button", { name: "메시지 보내기" }));
  assert.equal(
    t("Message #{channel}", { channel: "English 이름 {scope}" }),
    "#English 이름 {scope}에 메시지 보내기",
  );
  assert.equal(t("Unknown English copy"), "Unknown English copy");
  assert.equal(t("constructor"), "constructor");
  act(() => setLocale("en"));
  assert.ok(screen.getByRole("button", { name: "Send message" }));
  assert.equal(window.localStorage.getItem(LOCALE_STORAGE_KEY), "en");
  assert.equal(document.documentElement.lang, "en");
});

test("a failed persist leaves language unchanged and can be retried", () => {
  setLocale("en");
  const prototype = Object.getPrototypeOf(window.localStorage);
  const original = prototype.setItem;
  prototype.setItem = () => {
    throw new Error("storage full");
  };
  try {
    assert.throws(() => setLocale("ko"), /storage full/);
    assert.equal(getLocale(), "en");
    assert.equal(window.localStorage.getItem(LOCALE_STORAGE_KEY), "en");
    assert.equal(document.documentElement.lang, "en");
  } finally {
    prototype.setItem = original;
  }
  setLocale("ko");
  assert.equal(getLocale(), "ko");
  assert.equal(window.localStorage.getItem(LOCALE_STORAGE_KEY), "ko");
});

test("cross-window language changes and removal update subscribed UI", () => {
  setLocale("en");
  render(React.createElement(Menu));
  act(() =>
    window.dispatchEvent(
      new window.StorageEvent("storage", {
        key: LOCALE_STORAGE_KEY,
        newValue: "ko",
        storageArea: window.localStorage,
      }),
    ),
  );
  assert.ok(screen.getByRole("button", { name: "메시지 보내기" }));
  act(() =>
    window.dispatchEvent(
      new window.StorageEvent("storage", {
        key: LOCALE_STORAGE_KEY,
        newValue: "en",
        storageArea: window.localStorage,
      }),
    ),
  );
  assert.ok(screen.getByRole("button", { name: "Send message" }));
  act(() =>
    window.dispatchEvent(
      new window.StorageEvent("storage", {
        key: LOCALE_STORAGE_KEY,
        newValue: null,
        storageArea: window.localStorage,
      }),
    ),
  );
  assert.ok(screen.getByRole("button", { name: "메시지 보내기" }));
});

test("missing or unsupported choices use Korean", () => {
  for (const value of [null, undefined, "", "fr", "ko"]) {
    assert.equal(resolveLocale(value), "ko");
  }
  assert.equal(resolveLocale("en"), "en");
});
