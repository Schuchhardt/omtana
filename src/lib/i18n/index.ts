/**
 * Idioma de la interfaz (ES / EN).
 *
 * Es distinto del idioma de la meditación, que se elige al personalizar y vive
 * en `LOCALES` (ahí también hay portugués). Acá solo están los dos idiomas en
 * los que está escrita la aplicación.
 *
 * Este módulo es datos puros a propósito: lo importan componentes de servidor y
 * de cliente, y las páginas le pasan trozos del diccionario a sus hijos de
 * cliente como props. Por eso el diccionario no puede contener funciones. Los
 * textos con números usan marcadores `{n}` y se arman con `fill`.
 *
 * La lectura de la cookie está en `../lang.ts`, que sí es solo de servidor.
 */

import { es } from "./es";
import { en } from "./en";

export const UI_LANGS = ["es", "en"] as const;
export type UiLang = (typeof UI_LANGS)[number];

export const LANG_COOKIE = "omtana_lang";
/** Un año: la elección de idioma no caduca con la sesión. */
export const LANG_COOKIE_MAX_AGE = 31_536_000;

export const LANG_NAMES: Record<UiLang, string> = { es: "Español", en: "English" };

export function normalizeLang(value: string | null | undefined): UiLang | null {
  return (UI_LANGS as readonly string[]).includes(value ?? "") ? (value as UiLang) : null;
}

/** El español es la fuente: el inglés tiene que calzar clave por clave. */
export type Copy = typeof es;

export const COPY: Record<UiLang, Copy> = { es, en };

export function copy(lang: UiLang): Copy {
  return COPY[lang];
}

/* ───────────────────────────── plantillas ───────────────────────────── */

/** Reemplaza `{clave}` por su valor. `fill("{n} min", { n: 5 })` → `"5 min"`. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match,
  );
}

export interface Plural {
  one: string;
  other: string;
}

/** Elige la forma singular o plural y rellena `{n}` con el número. */
export function plural(forms: Plural, n: number): string {
  return fill(n === 1 ? forms.one : forms.other, { n });
}

/* ──────────────────── vocabularios que vienen de la base ──────────────────── */

/**
 * La base guarda género, tono y acento de las voces en español, y los rótulos
 * de sección de `planSession()` también. Son vocabularios cerrados, así que se
 * traducen al mostrarlos; si aparece un valor nuevo se muestra tal cual en vez
 * de romperse.
 *
 * El nombre de cada voz no se traduce (es un nombre propio). Su acento y su
 * descripción sí, pero esos son texto libre y viajan traducidos con la fila:
 * ver `localized` más abajo.
 */
function lookup(table: Record<string, string>, value: string): string {
  return table[value] ?? value;
}

export function sectionLabel(lang: UiLang, label: string): string {
  return lookup(COPY[lang].vocab.sections, label);
}

export function voiceGender(lang: UiLang, value: string): string {
  return lookup(COPY[lang].vocab.gender, value);
}

export function voiceTone(lang: UiLang, value: string): string {
  return lookup(COPY[lang].vocab.tone, value);
}


/* ──────────────────── contenido traducible de la base ──────────────────── */

/**
 * Traducciones que viajan con la fila: `{"en": {"title": "…"}}`. El español
 * vive en la columna base, así que solo están los otros idiomas.
 */
export type Translations = Record<string, Record<string, string> | undefined>;

export interface Translatable {
  i18n?: Translations | null;
}

/**
 * Valor de un campo en el idioma pedido, con la columna base de respaldo.
 *
 * Una fila sin traducir se muestra en español, que es como estaba antes de
 * existir la columna: nada se rompe por seedear a medias.
 */
export function localized<T extends Translatable>(
  row: T,
  lang: UiLang | string,
  field: keyof T & string,
): string {
  const translated = row.i18n?.[lang]?.[field];
  return translated && translated.trim() ? translated : String(row[field] ?? "");
}

/* ──────────────────── historial de créditos ──────────────────── */

/**
 * El historial guarda una clave estable y sus parámetros, no una frase. Así el
 * movimiento de hace seis meses se lee en el idioma de hoy.
 */
export interface LedgerReason {
  reason: string;
  reason_key: string | null;
  reason_meta: Record<string, string | number> | null;
}

export function ledgerReason(lang: UiLang, entry: LedgerReason): string {
  const t = COPY[lang].ledger;
  const template = entry.reason_key ? t[entry.reason_key] : undefined;
  // Las filas anteriores a la migración no tienen clave: se muestra el texto
  // guardado, que quedó en el idioma que tenía la cuenta entonces.
  if (!template) return entry.reason;
  return fill(template, entry.reason_meta ?? {});
}
