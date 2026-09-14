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
}

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

export interface LedgerEntry extends LedgerReason {
  id: string;
  delta: number;
  created_at: string;
}
