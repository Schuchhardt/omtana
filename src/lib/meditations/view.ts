import "server-only";
import { db } from "../supabase";
import { signedUrl } from "../storage";
import { copy, normalizeLang } from "../i18n";
import { classifyGenerationError } from "../generation/errors";
import { failGeneration, isStale, staleReason, type JobRow } from "../generation/jobs";
import { refundFailedGeneration } from "./refund";
import { channelOf, type Meditation, type MeditationSegment } from "../types";

/**
 * Una meditación vista desde un asistente: en qué va, dónde escucharla y,
 * cuando está lista, el audio directo.
 *
 * Hace lo mismo que `/status` cuando alguien espera en la web: da por fallido
 * un job que nadie va a terminar y devuelve lo cobrado si falló. Un asistente
 * que pregunta por su sesión es alguien esperando.
 */

export const AUDIO_URL_TTL_HOURS = 3;

export function siteUrl(origin: string): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || origin).replace(/\/$/, "");
}

export function playerUrl(site: string, id: string): string {
  return `${site}/reproductor/${id}`;
}

function stepLabel(step: string | null, lang: string): string | null {
  if (!step) return null;
  const steps = copy(normalizeLang(lang) ?? "es").player.steps;
  if (step.startsWith("voz:") || step.startsWith("plantilla:voz:")) return steps.voz;
  return steps[step] ?? steps.fallback;
}

export interface ViewOptions {
  site: string;
  /** Idioma de los rótulos (paso, error). */
  lang?: string;
  /** El admin ve el error técnico y el job; la persona, el mensaje para ella. */
  admin?: boolean;
  includeScript?: boolean;
}

export async function latestJob(meditationId: string): Promise<JobRow | null> {
  const { data } = await db()
    .from("omtana_generation_jobs")
    .select("id, meditation_id, step, error, status, created_at, started_at, finished_at")
    .eq("meditation_id", meditationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as JobRow | null) ?? null;
}

export async function viewMeditation(meditation: Meditation, opts: ViewOptions) {
  const lang = opts.lang ?? meditation.locale;
  let job = await latestJob(meditation.id);

  if (job && isStale(job)) {
    const reason = staleReason(job);
    if (await failGeneration({ meditationId: meditation.id, jobId: job.id, error: reason })) {
      meditation = { ...meditation, status: "failed" };
      job = { ...job, status: "failed", error: reason };
    }
  }

  let refunded = false;
  if (meditation.status === "failed") refunded = await refundFailedGeneration(meditation.id);

  const t = copy(normalizeLang(lang) ?? "es").player;
  const friendlyError =
    meditation.status === "failed"
      ? classifyGenerationError(job?.error) === "refused"
        ? t.failedRefused
        : t.failedInternal
      : null;

  const [voice, breathing, music] = await Promise.all([
    meditation.voice_id
      ? db().from("omtana_voices").select("slug, name").eq("id", meditation.voice_id).maybeSingle()
      : null,
    meditation.breathing_exercise_id
      ? db().from("omtana_breathing_exercises").select("slug, name").eq("id", meditation.breathing_exercise_id).maybeSingle()
      : null,
    meditation.music_track_id
      ? db().from("omtana_music_tracks").select("slug, name").eq("id", meditation.music_track_id).maybeSingle()
      : null,
  ]);

  const view: Record<string, unknown> = {
    id: meditation.id,
    title: meditation.title,
    status: meditation.status,
    step: meditation.status === "ready" ? null : stepLabel(job?.step ?? null, lang),
    error: opts.admin ? (job?.error ?? null) : friendlyError,
    ...(refunded ? { refunded: "Se devolvió lo cobrado por esta sesión." } : {}),
    player_url: playerUrl(opts.site, meditation.id),
    audio_url: meditation.status === "ready" ? await signedUrl(meditation.audio_path) : null,
    ...(meditation.status === "ready" ? { audio_url_expires_in_hours: AUDIO_URL_TTL_HOURS } : {}),
    duration_seconds: meditation.duration_seconds,
    duration_minutes: Math.round(meditation.duration_seconds / 60),
    locale: meditation.locale,
    visibility: meditation.visibility,
    voice: voice?.data ?? null,
    breathing: breathing?.data
      ? { ...breathing.data, note: "Suena antes de la meditación, como pista aparte en el reproductor." }
      : null,
    music: music?.data
      ? { ...music.data, baked: true }
      : { baked: false, note: "Sin música horneada: el reproductor ofrece el banco de música en vivo." },
    script_mode: meditation.script_mode ?? "modelo",
    created_at: meditation.created_at,
    ready_at: meditation.ready_at,
  };

  if (meditation.visibility === "private") {
    view.player_note = "Es privada: el link del reproductor pide iniciar sesión con la cuenta dueña. El audio_url funciona sin sesión mientras no venza.";
  }

  if (opts.admin) {
    view.owner_id = meditation.user_id;
    view.source = meditation.source;
    view.created_via = channelOf(meditation);
    view.job = job;
    view.intention_text = meditation.intention_text;
    view.context_text = meditation.context_text;
  }

  if (opts.includeScript && meditation.status === "ready") {
    const { data } = await db()
      .from("omtana_meditation_segments")
      .select("position, kind, label, script_text, start_offset_seconds, seconds")
      .eq("meditation_id", meditation.id)
      .order("position");
    view.script = ((data as MeditationSegment[]) ?? []).map((s) => ({
      label: s.label,
      kind: s.kind,
      at_seconds: s.start_offset_seconds,
      seconds: s.seconds,
      text: s.script_text,
    }));
  }

  return view;
}

export async function loadMeditation(id: string): Promise<Meditation | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db().from("omtana_meditations").select("*").eq("id", id).maybeSingle();
  return (data as Meditation | null) ?? null;
}

/**
 * Espera a que la sesión termine, hasta `seconds`. La función de Netlify que
 * atiende el MCP se corta a los 60 s, así que el tope es 45: más que eso se
 * consulta de nuevo con `get_meditation`.
 */
export const MAX_WAIT_SECONDS = 45;

export async function waitForMeditation(id: string, seconds: number): Promise<Meditation | null> {
  const deadline = Date.now() + Math.min(MAX_WAIT_SECONDS, Math.max(0, seconds)) * 1000;
  let meditation = await loadMeditation(id);
  while (
    meditation &&
    (meditation.status === "pending" || meditation.status === "generating") &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000, Math.max(250, deadline - Date.now()))));
    meditation = await loadMeditation(id);
  }
  return meditation;
}
