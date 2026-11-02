import "server-only";
import { db, isConfigured } from "../supabase";
import { localized } from "../i18n";
import type { BreathingExercise } from "../breathing";
import type { Intention, MusicTrack, Voice } from "../types";

/**
 * Todo lo que se puede elegir al pedir una meditación, en una sola lectura.
 *
 * Los MCP resuelven nombres que vienen de un asistente ("la voz de Aurora",
 * "caja", "lluvia"), así que todo se busca por slug, por id o por nombre sin
 * importar mayúsculas ni tildes.
 */

export interface RenderOption {
  exercise_id: string;
  voice_id: string;
  locale: string;
  slot_seconds: number;
  seconds: number;
}

export interface Catalog {
  voices: Voice[];
  intentions: Intention[];
  breathing: BreathingExercise[];
  music: MusicTrack[];
  renders: RenderOption[];
}

export async function loadCatalog(): Promise<Catalog> {
  if (!isConfigured()) return { voices: [], intentions: [], breathing: [], music: [], renders: [] };
  const [voices, intentions, breathing, music, renders] = await Promise.all([
    db().from("omtana_voices").select("*").eq("active", true).order("sort"),
    db().from("omtana_intentions").select("*").eq("active", true).order("sort"),
    db().from("omtana_breathing_exercises").select("*").eq("active", true).order("sort"),
    db().from("omtana_music_tracks").select("*").eq("active", true).order("name"),
    db().from("omtana_breathing_renders").select("exercise_id, voice_id, locale, slot_seconds, seconds"),
  ]);
  return {
    voices: (voices.data as Voice[]) ?? [],
    // Las intenciones "Tuya" son las que la gente escribió a mano: no son banco.
    intentions: ((intentions.data as Intention[]) ?? []).filter((i) => i.category !== "libre"),
    breathing: (breathing.data as BreathingExercise[]) ?? [],
    music: (music.data as MusicTrack[]) ?? [],
    renders: (renders.data as RenderOption[]) ?? [],
  };
}

export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function find<T extends { id: string; slug: string; name?: string; title?: string }>(
  rows: T[],
  ref: string | null | undefined,
): T | null {
  if (!ref?.trim()) return null;
  const key = fold(ref);
  return (
    rows.find((r) => r.id === ref.trim()) ??
    rows.find((r) => fold(r.slug) === key) ??
    rows.find((r) => fold(r.name ?? r.title ?? "") === key) ??
    null
  );
}

export const findVoice = (c: Catalog, ref?: string | null) => find(c.voices, ref);
export const findIntention = (c: Catalog, ref?: string | null) => find(c.intentions, ref);
export const findBreathing = (c: Catalog, ref?: string | null) => find(c.breathing, ref);
export const findMusic = (c: Catalog, ref?: string | null) => find(c.music, ref);

/** Una voz sirve si está enlazada con el proveedor y habla ese idioma. */
export function voiceUsable(voice: Voice, locale: string): boolean {
  return !!voice.provider_voice_id && voice.languages.includes(locale);
}

export function voicesFor(c: Catalog, locale: string): Voice[] {
  return c.voices.filter((v) => voiceUsable(v, locale));
}

/** ¿Hay audio grabado de este ejercicio para esta voz, idioma y hueco? */
export function breathingRender(
  c: Catalog,
  exerciseId: string,
  voiceId: string,
  locale: string,
  slotSeconds: number,
): RenderOption | null {
  return (
    c.renders.find(
      (r) =>
        r.exercise_id === exerciseId &&
        r.voice_id === voiceId &&
        r.locale === locale &&
        r.slot_seconds === slotSeconds,
    ) ?? null
  );
}

/** Los ejercicios que suenan con esta voz, en este idioma y en este hueco. */
export function breathingFor(
  c: Catalog,
  voiceId: string,
  locale: string,
  slotSeconds: number,
): BreathingExercise[] {
  return c.breathing.filter((b) => breathingRender(c, b.id, voiceId, locale, slotSeconds));
}

/** Resumen del catálogo para mostrarle a un asistente. */
export function describeCatalog(c: Catalog, locale?: string) {
  const voices = locale ? voicesFor(c, locale) : c.voices.filter((v) => v.provider_voice_id);
  return {
    voices: voices.map((v) => ({
      slug: v.slug,
      name: v.name,
      gender: v.gender,
      tone: v.tone,
      accent: v.accent,
      languages: v.languages,
      description: localized(v, locale ?? "es", "blurb"),
    })),
    intentions: c.intentions.map((i) => ({
      slug: i.slug,
      title: localized(i, locale ?? "es", "title"),
      summary: localized(i, locale ?? "es", "summary"),
      area: i.category,
      durations: i.durations,
    })),
    breathing: c.breathing.map((b) => {
      const renders = c.renders.filter((r) => r.exercise_id === b.id && (!locale || r.locale === locale));
      const voiceSlugs = [
        ...new Set(renders.map((r) => c.voices.find((v) => v.id === r.voice_id)?.slug).filter(Boolean)),
      ];
      return {
        slug: b.slug,
        name: localized(b, locale ?? "es", "name"),
        summary: localized(b, locale ?? "es", "summary"),
        recorded_with_voices: voiceSlugs,
      };
    }),
    music: c.music.map((m) => ({ slug: m.slug, name: m.name, mood: m.mood })),
  };
}
