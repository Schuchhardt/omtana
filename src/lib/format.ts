import { copy, fill, plural, type UiLang } from "./i18n";

export function formatDuration(seconds: number, lang: UiLang = "es"): string {
  const minutes = Math.round(seconds / 60);
  return fill(copy(lang).common.minutesWithValue, { n: minutes });
}

/** El reloj del reproductor no cambia con el idioma. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "14 de marzo" / "March 14": el orden viene de la plantilla del diccionario. */
export function formatDate(iso: string, lang: UiLang = "es"): string {
  const t = copy(lang).format;
  const d = new Date(iso);
  return fill(t.shortDate, { day: d.getDate(), month: t.months[d.getMonth()] });
}

export function formatLongDate(iso: string, lang: UiLang = "es"): string {
  const t = copy(lang).format;
  const d = new Date(iso);
  return fill(t.longDate, { month: t.months[d.getMonth()], year: d.getFullYear() });
}

export function greeting(lang: UiLang = "es", date = new Date()): string {
  const t = copy(lang).format;
  const h = date.getHours();
  if (h < 12) return t.greetingMorning;
  if (h < 20) return t.greetingAfternoon;
  return t.greetingEvening;
}

export function plays(n: number, lang: UiLang = "es"): string {
  return plural(copy(lang).format.plays, n);
}
