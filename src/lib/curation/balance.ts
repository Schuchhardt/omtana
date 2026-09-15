/**
 * Qué le falta al banco para estar parejo.
 *
 * Todo lo de este archivo se calcula leyendo la base, sin modelo y sin costo.
 * Es a propósito: la mitad de las decisiones de curaduría no necesitan que
 * nadie opine — si una intención declara que existe en diez y en veinte
 * minutos y solo está generada la de diez, eso es un hueco y punto. Lo que sí
 * necesita criterio (qué intención nueva hace falta, qué ejercicio de
 * respiración vale la pena sumar) vive en `./research`, que parte de este
 * informe y lo deja como propuesta para que alguien la mire.
 *
 * Tres ejes de equilibrio, que son los que la portada usa para ordenarse:
 *
 *   área de la vida   trabajo, dinero, salud, relaciones, comunidad, práctica
 *   necesidad         dormir, ansiedad, foco, cuerpo, emoción, vínculo, sentido
 *   forma             duración, idioma, y el ejercicio con el que abre
 */
import { db } from "../supabase";
import type { BreathingExercise, Phase } from "../breathing";
import type { Intention } from "../types";

export interface Coverage {
  key: string;
  intentions: number;
  meditations: number;
  videos: number;
}

export type GapKind = "meditation" | "video" | "breathing" | "intention";

export interface Gap {
  kind: GapKind;
  /** Cómo se nombra el hueco en el informe. */
  label: string;
  /** Cuánto pesa: primero lo que deja un área entera sin cubrir. */
  score: number;
  /** Lo que hace falta para taparlo, cuando se puede generar sin decidir nada. */
  job?: { intentionSlug: string; duration: number; locale: string };
}

export interface BalanceReport {
  areas: Coverage[];
  needs: Coverage[];
  /** Duración → cuántas meditaciones públicas y listas hay. */
  durations: { minutes: number; meditations: number }[];
  locales: { locale: string; meditations: number }[];
  breathing: {
    /** Patrones respaldados que el banco cubre y los que no. */
    families: { key: string; label: string; exercises: string[] }[];
    /** Ejercicios activos sin audio grabado para alguna voz enlazada. */
    unrecorded: string[];
  };
  gaps: Gap[];
  totals: {
    intentions: number;
    /** Sesiones públicas que cuelgan de una intención viva del banco. */
    meditations: number;
    /**
     * Sesiones públicas de intenciones retiradas. Siguen sonando en el
     * catálogo, pero no cuentan para el equilibrio: su área ya no existe.
     */
    retired: number;
    videos: number;
    exercises: number;
  };
}

/**
 * Las familias de respiración con respaldo publicado que vale la pena tener.
 *
 * No son nombres de ejercicios sino formas de la curva, que es lo que define
 * el efecto: lo que baja la activación es que la exhalación sea más larga que
 * la inhalación, no que el ejercicio se llame 4-7-8. Un banco con cuatro
 * ejercicios que son la misma forma está tan desequilibrado como uno con dos.
 */
export const FAMILIES: { key: string; label: string; test: (phases: Phase[]) => boolean }[] = [
  {
    key: "exhalacion-larga",
    label: "Exhalación más larga que la inhalación",
    test: (phases) => exhale(phases) >= inhale(phases) * 1.5,
  },
  {
    key: "retencion",
    label: "Con retención del aire",
    test: (phases) => phases.some((p) => p.kind === "hold" && p.seconds > 0),
  },
  {
    key: "coherente",
    label: "Resonante: cinco a seis respiraciones por minuto, sin retención",
    test: (phases) => {
      // Dos fases y nada más: un suspiro fisiológico también suma once
      // segundos sin retenciones, y no es lo mismo — lo que define a la
      // resonante es que el ciclo sea una inhalación y una exhalación.
      if (phases.length !== 2) return false;
      const total = phases.reduce((n, p) => n + p.seconds, 0);
      return total >= 9 && total <= 12;
    },
  },
  {
    key: "suspiro",
    label: "Doble inhalación (suspiro fisiológico)",
    test: (phases) => phases.filter((p) => p.kind === "inhale").length >= 2,
  },
  {
    key: "simetrico",
    label: "Simétrico, con pulmones llenos y vacíos",
    test: (phases) =>
      phases.length >= 4 &&
      phases.some((p) => p.kind === "empty") &&
      new Set(phases.map((p) => p.seconds)).size === 1,
  },
];

function inhale(phases: Phase[]): number {
  return phases.filter((p) => p.kind === "inhale").reduce((n, p) => n + p.seconds, 0) || 1;
}

function exhale(phases: Phase[]): number {
  return phases.filter((p) => p.kind === "exhale").reduce((n, p) => n + p.seconds, 0);
}

/** Idiomas que el banco se compromete a cubrir. El resto es extra. */
const CORE_LOCALES = ["es"];

export async function balance(): Promise<BalanceReport> {
  const [intentions, meditations, exports, exercises, renders, voices] = await Promise.all([
    db().from("omtana_intentions").select("*").eq("active", true).order("sort")
      .then((r) => (r.data as Intention[]) ?? []),
    db()
      .from("omtana_meditations")
      .select("id, intention_id, locale, duration_seconds, breathing_slot_seconds, plays")
      .eq("visibility", "public")
      .eq("status", "ready")
      .then((r) => (r.data as MeditationRow[]) ?? []),
    db().from("omtana_video_exports").select("meditation_id, format, status").eq("status", "ready")
      .then((r) => (r.data as { meditation_id: string; format: string }[]) ?? []),
    db().from("omtana_breathing_exercises").select("*").eq("active", true).order("sort")
      .then((r) => (r.data as BreathingExercise[]) ?? []),
    db().from("omtana_breathing_renders").select("exercise_id, voice_id, locale, slot_seconds")
      .then((r) => (r.data as RenderRow[]) ?? []),
    db().from("omtana_voices").select("id, slug, active, provider_voice_id").eq("active", true)
      .then((r) => (r.data as VoiceRow[]) ?? []),
  ]);

  const byIntention = new Map(intentions.map((i) => [i.id, i]));
  const withVideo = new Set(exports.map((e) => e.meditation_id));

  const areas = tally(intentions, meditations, withVideo, byIntention, (i) => i.category);
  const needs = tally(intentions, meditations, withVideo, byIntention, (i) => i.tag || "sin etiqueta");

  const durations = [5, 10, 15, 20].map((minutes) => ({
    minutes,
    meditations: meditations.filter((m) => sessionMinutes(m) === minutes).length,
  }));

  const locales = [...new Set(meditations.map((m) => m.locale))].map((locale) => ({
    locale,
    meditations: meditations.filter((m) => m.locale === locale).length,
  }));

  const families = FAMILIES.map((family) => ({
    key: family.key,
    label: family.label,
    exercises: exercises.filter((e) => family.test(e.phases)).map((e) => e.slug),
  }));

  const linked = voices.filter((v) => v.provider_voice_id);
  const recorded = new Set(renders.map((r) => `${r.exercise_id}:${r.voice_id}`));
  const unrecorded = exercises
    .filter((e) => linked.some((v) => !recorded.has(`${e.id}:${v.id}`)))
    .map((e) => e.slug);

  const live = meditations.filter((m) => m.intention_id && byIntention.has(m.intention_id));

  return {
    areas,
    needs,
    durations,
    locales,
    breathing: { families, unrecorded },
    gaps: findGaps({ intentions, meditations, withVideo, areas, needs, families, unrecorded }),
    totals: {
      intentions: intentions.length,
      meditations: live.length,
      retired: meditations.length - live.length,
      videos: exports.length,
      exercises: exercises.length,
    },
  };
}

interface MeditationRow {
  id: string;
  intention_id: string | null;
  locale: string;
  duration_seconds: number;
  breathing_slot_seconds: number;
  plays: number;
}

interface RenderRow {
  exercise_id: string;
  voice_id: string;
  locale: string;
  slot_seconds: number;
}

interface VoiceRow {
  id: string;
  slug: string;
  active: boolean;
  provider_voice_id: string | null;
}

/**
 * Los minutos que pidió la sesión, no los que dura el archivo.
 *
 * `duration_seconds` mide solo el cuerpo desde que la respiración salió del
 * audio, así que hay que devolverle el hueco antes de redondear: si no, una
 * sesión de quince se cuenta como una de trece y el informe ve huecos donde no
 * los hay.
 */
function sessionMinutes(m: MeditationRow): number {
  return Math.round((m.duration_seconds + (m.breathing_slot_seconds ?? 0)) / 60);
}

function tally(
  intentions: Intention[],
  meditations: MeditationRow[],
  withVideo: Set<string>,
  byIntention: Map<string, Intention>,
  key: (intention: Intention) => string,
): Coverage[] {
  const rows = new Map<string, Coverage>();

  const touch = (k: string): Coverage => {
    const row = rows.get(k) ?? { key: k, intentions: 0, meditations: 0, videos: 0 };
    rows.set(k, row);
    return row;
  };

  for (const intention of intentions) touch(key(intention)).intentions++;

  for (const m of meditations) {
    const intention = m.intention_id ? byIntention.get(m.intention_id) : undefined;
    if (!intention) continue;
    const row = touch(key(intention));
    row.meditations++;
    if (withVideo.has(m.id)) row.videos++;
  }

  return [...rows.values()].sort((a, b) => a.meditations - b.meditations || a.key.localeCompare(b.key));
}

/* ───────────────────────── huecos ───────────────────────── */

interface GapInput {
  intentions: Intention[];
  meditations: MeditationRow[];
  withVideo: Set<string>;
  areas: Coverage[];
  needs: Coverage[];
  families: { key: string; label: string; exercises: string[] }[];
  unrecorded: string[];
}

/**
 * Los huecos, ordenados por lo que más desequilibra.
 *
 * El orden importa porque de acá sale lo que se genera sin que nadie elija:
 * primero las intenciones del área más floja, y dentro de un área, la duración
 * que la intención declara y no existe.
 */
function findGaps(input: GapInput): Gap[] {
  const gaps: Gap[] = [];
  const area = new Map(input.areas.map((a) => [a.key, a]));
  const worst = Math.max(...input.areas.map((a) => a.meditations), 1);

  const generated = new Map<string, Set<number>>();
  for (const m of input.meditations) {
    if (!m.intention_id || !CORE_LOCALES.includes(m.locale)) continue;
    const set = generated.get(m.intention_id) ?? new Set<number>();
    set.add(sessionMinutes(m));
    generated.set(m.intention_id, set);
  }

  for (const intention of input.intentions) {
    const done = generated.get(intention.id) ?? new Set<number>();
    for (const duration of intention.durations) {
      if (done.has(duration)) continue;
      // Un área con la mitad de sesiones que la más cubierta pesa el doble.
      const coverage = area.get(intention.category)?.meditations ?? 0;
      gaps.push({
        kind: "meditation",
        label: `${intention.category} · ${intention.title} · ${duration} min`,
        score: 100 * (1 - coverage / worst) + 10,
        job: { intentionSlug: intention.slug, duration, locale: CORE_LOCALES[0] },
      });
    }
  }

  for (const family of input.families) {
    if (family.exercises.length > 0) continue;
    gaps.push({
      kind: "breathing",
      label: `Sin ejercicio de respiración: ${family.label.toLowerCase()}`,
      score: 80,
    });
  }

  for (const slug of input.unrecorded) {
    gaps.push({
      kind: "breathing",
      label: `"${slug}" no está grabado para todas las voces enlazadas`,
      score: 40,
    });
  }

  // Un área sin intenciones propias no se puede tapar generando: hace falta
  // escribir la intención primero, y eso pasa por la investigación.
  for (const row of input.areas) {
    if (row.intentions >= 4) continue;
    gaps.push({
      kind: "intention",
      label: `El área "${row.key}" tiene ${row.intentions} intención(es) en el banco`,
      score: 90,
    });
  }

  const sinVideo = input.meditations.filter((m) => !input.withVideo.has(m.id)).length;
  if (sinVideo > 0) {
    gaps.push({
      kind: "video",
      label: `${sinVideo} meditación(es) pública(s) sin video`,
      score: 30,
    });
  }

  return gaps.sort((a, b) => b.score - a.score);
}

/** Los trabajos de generación que salen del informe, en orden y sin repetir. */
export function generationJobs(report: BalanceReport, limit: number) {
  const seen = new Set<string>();
  const jobs: NonNullable<Gap["job"]>[] = [];

  for (const gap of report.gaps) {
    if (!gap.job || jobs.length >= limit) continue;
    const key = `${gap.job.intentionSlug}:${gap.job.duration}:${gap.job.locale}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push(gap.job);
  }

  return jobs;
}
