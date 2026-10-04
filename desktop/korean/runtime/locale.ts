import { useSyncExternalStore } from "react";
import { koreanMessages } from "./messages";

export type Locale = "ko" | "en";
export const LOCALE_STORAGE_KEY = "buzz-ui-language.v1";

/** Resolve a saved UI language; this Korean fork defaults to Korean. */
export function resolveLocale(value: unknown): Locale {
  return value === "en" ? "en" : "ko";
}

function readLocale(): Locale {
  try {
    return resolveLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return "ko";
  }
}

let locale = readLocale();
const listeners = new Set<() => void>();

/** Current UI language, including the saved choice on startup. */
export function getLocale(): Locale {
  return locale;
}

function publishLocale(next: Locale) {
  locale = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function onStorage(event: StorageEvent) {
  if (event.storageArea !== window.localStorage) return;
  if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
    publishLocale(resolveLocale(event.newValue));
  }
}

/** Persist one language choice before publishing it; storage errors propagate. */
export function setLocale(next: Locale) {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
  publishLocale(next);
}

/** Subscribe a translated component without remounting it or losing drafts. */
export function useLocale(): Locale {
  return useSyncExternalStore(
    subscribe,
    () => locale,
    () => "ko",
  );
}

/** Translate interface copy only; parameters are inserted as plain text. */
export function t(
  message: string,
  params: Record<string, string | number> = {},
): string {
  const translated =
    locale === "ko" && Object.hasOwn(koreanMessages, message)
      ? koreanMessages[message]
      : message;
  return translated.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
