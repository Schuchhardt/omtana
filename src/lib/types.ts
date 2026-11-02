import type { BreathingCue, BreathingStep } from "./breathing";
import type { LedgerReason, Translatable } from "./i18n";

export type Plan = "free" | "pro";
export type Visibility = "private" | "public";
export type MeditationStatus = "pending" | "generating" | "ready" | "failed";
export type SectionKind = "fixed" | "dynamic";
export type Source = "curated" | "user";

export interface UserPrefs {
  daily_reminder: boolean;
  voice_emails: boolean;
  publish_by_default: boolean;
  improve_service: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  credits: number;
  free_used_period: number;
  period_started: string;
  locale: string;
  default_voice_id: string | null;
  default_duration: number;
  prefs: UserPrefs;
  stripe_customer_id: string | null;
  created_at: string;
}

export interface Voice extends Translatable {
  id: string;
  slug: string;
  name: string;
  accent: string;
  gender: "Femenina" | "Masculina";
  tone: "Grave" | "Media" | "Aguda";
  languages: string[];
  blurb: string;
  provider_voice_id: string | null;
  provider_settings: Record<string, number>;
  sample_url: string | null;
  sort: number;
  active: boolean;
}

export interface MusicTrack {
  id: string;
  slug: string;
  name: string;
  mood: string;
  audio_path: string;
  duration_seconds: number;
  loopable: boolean;
  active: boolean;
}

export interface Intention extends Translatable {
  id: string;
  slug: string;
  title: string;
  summary: string;
  tag: string;
  category: string;
  durations: number[];
  brief: string;
  sort: number;
  active: boolean;
}

export interface Meditation {
  id: string;
  user_id: string | null;
  intention_id: string | null;
  template_id: string | null;
  voice_id: string | null;
  music_track_id: string | null;
  breathing_exercise_id: string | null;
  /** Hueco que la sesión le reservó a la respiración al crearla. */
  breathing_slot_seconds: number;
  /** 1: la respiración venía dentro del audio. 2: va aparte y es opcional. */
  plan_version: number;
  title: string;
  intention_text: string;
  context_text: string;
  locale: string;
  duration_seconds: number;
  source: Source;
  visibility: Visibility;
  status: MeditationStatus;
  audio_path: string | null;
  keywords: string[];
  plays: number;
  created_at: string;
  ready_at: string | null;
  /**
   * Quién escribió el guion. null: el modelo. 'tramo': la persona trajo el
   * tramo personalizado. 'completo': la meditación entera es su texto.
   */
  script_mode?: ScriptMode | null;
  script_override?: string | null;
  /** Por dónde se pidió: web, mcp, admin. El CLI no la llena (ver `channelOf`). */
  created_via?: string;
}

/**
 * Por dónde entró una meditación. La columna vale 'web' por defecto, y el CLI
 * no la llena (así sus tandas no dependen de la migración 0008): una fila con
 * 'web' y sin dueño es del CLI, porque la web siempre tiene a alguien detrás.
 */
export function channelOf(m: { created_via?: string | null; user_id: string | null }): string {
  if (m.created_via && m.created_via !== "web") return m.created_via;
  return m.user_id ? "web" : "cli";
}

export type ScriptMode = "tramo" | "completo";

export interface MeditationSegment {
  id: string;
  meditation_id: string;
  position: number;
  kind: SectionKind;
  label: string;
  script_text: string;
  audio_path: string | null;
  start_offset_seconds: number;
  seconds: number;
}

export interface Cue {
  at_seconds: number;
  word: string;
}

/**
 * Un ejercicio de respiración ya armado para una voz, un idioma y un hueco.
 *
 * `timeline` y `steps` vienen de `planBreathing`: se guardan con el audio para
 * que el reproductor anime exactamente lo que se grabó, aunque el ejercicio
 * cambie después en el banco.
 */
export interface BreathingRender {
  id: string;
  exercise_id: string;
  voice_id: string;
  locale: string;
  slot_seconds: number;
  cycles: number;
  seconds: number;
  audio_path: string;
  timeline: BreathingCue[];
  steps: BreathingStep[];
  checked_at: string | null;
  check_report: BreathingCheck | null;
}

export interface BreathingCheck {
  totalSeconds: number;
  expectedSeconds: number;
  maxDriftSeconds: number;
  cuesChecked: number;
  /** Señales que suenan pegadas a la anterior: a un conteo por segundo, normal. */
  cuesGlued: number;
  problems: string[];
}

export interface LedgerEntry extends LedgerReason {
  id: string;
  delta: number;
  created_at: string;
}
