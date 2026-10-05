import { getLocale, t } from "./locale";

/** Reuse both formatters while resolving the active language at each render. */
export function localizedDateTimeFormat(options: Intl.DateTimeFormatOptions) {
  const formats = {
    ko: new Intl.DateTimeFormat("ko-KR", options),
    en: new Intl.DateTimeFormat("en-US", options),
  };
  return {
    format: (date: Date) => {
      const locale = getLocale();
      if (locale === "en") return formats.en.format(date);
      // Some native ICU builds retain English day-period labels for ko-KR.
      return formats.ko
        .formatToParts(date)
        .map((part) => {
          if (part.type === "dayPeriod") {
            if (part.value === "AM") return "오전";
            if (part.value === "PM") return "오후";
          }
          return part.value;
        })
        .join("");
    },
  };
}

/** Translate the known wave fallback at display time, preserving custom text. */
export function translateWaveFallback(fallback: string): string {
  const suffix = " waved at you.";
  if (!fallback.endsWith(suffix)) return fallback;
  const name = fallback.slice(0, -suffix.length);
  return name ? t("{name} waved at you.", { name }) : fallback;
}
