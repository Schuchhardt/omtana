import "server-only";
import { db, isConfigured } from "./supabase";
import { PLAN } from "./config";
import type {
  Cue,
  Intention,
  LedgerEntry,
  Meditation,
  MeditationSegment,
  MusicTrack,
  User,
  Voice,
} from "./types";

export async function listIntentions(): Promise<Intention[]> {
  if (!isConfigured()) return [];
  const { data } = await db()
    .from("omtana_intentions")
    .select("*")
    .eq("active", true)
    .order("sort");
  return (data as Intention[]) ?? [];
}

export async function listVoices(): Promise<Voice[]> {
  if (!isConfigured()) return [];
  const { data } = await db()
    .from("omtana_voices")
    .select("*")
    .eq("active", true)
    .order("sort");
  return (data as Voice[]) ?? [];
}

export async function listMusic(): Promise<MusicTrack[]> {
  if (!isConfigured()) return [];
  const { data } = await db()
    .from("omtana_music_tracks")
    .select("*")
    .eq("active", true)
    .order("name");
  return (data as MusicTrack[]) ?? [];
}

export async function getVoice(id: string | null): Promise<Voice | null> {
  if (!id) return null;
  const { data } = await db().from("omtana_voices").select("*").eq("id", id).maybeSingle();
  return (data as Voice) ?? null;
}

/**
 * Catálogo público: lo del equipo más lo que la comunidad publicó.
 *
 * `locale` acota al idioma de la meditación, que es el idioma del audio y no
 * el de la interfaz: son dos ejes distintos y una persona puede querer
 * escuchar en inglés con la aplicación en español.
 */
export async function listCatalog(limit = 24, locale?: string): Promise<Meditation[]> {
  if (!isConfigured()) return [];
  let query = db()
    .from("omtana_meditations")
    .select("*")
    .eq("visibility", "public")
    .eq("status", "ready");

  if (locale) query = query.eq("locale", locale);

  const { data } = await query.order("plays", { ascending: false }).limit(limit);
  return (data as Meditation[]) ?? [];
}

export async function listUserMeditations(userId: string): Promise<Meditation[]> {
  const { data } = await db()
    .from("omtana_meditations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data as Meditation[]) ?? [];
}

export async function recentForUser(userId: string, limit = 2): Promise<Meditation[]> {
  const { data } = await db()
    .from("omtana_plays")
    .select("meditation:omtana_meditations(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(12);

  const seen = new Set<string>();
  const out: Meditation[] = [];
  for (const row of (data ?? []) as { meditation: Meditation | Meditation[] | null }[]) {
    const m = Array.isArray(row.meditation) ? row.meditation[0] : row.meditation;
    if (!m || seen.has(m.id) || m.status !== "ready") continue;
    seen.add(m.id);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

/** Una meditación que este visitante tiene permitido escuchar. */
export async function getPlayable(
  id: string,
  userId: string | null,
): Promise<{ meditation: Meditation; segments: MeditationSegment[]; cues: Cue[]; voice: Voice | null } | null> {
  const { data } = await db().from("omtana_meditations").select("*").eq("id", id).maybeSingle();
  const meditation = data as Meditation | null;
  if (!meditation) return null;

  const mine = !!userId && meditation.user_id === userId;
  if (!mine && meditation.visibility !== "public") return null;

  const [segments, cues, voice] = await Promise.all([
    db()
      .from("omtana_meditation_segments")
      .select("*")
      .eq("meditation_id", id)
      .order("position")
      .then((r) => (r.data as MeditationSegment[]) ?? []),
    db()
      .from("omtana_meditation_cues")
      .select("at_seconds, word")
      .eq("meditation_id", id)
      .order("at_seconds")
      .then((r) => (r.data as Cue[]) ?? []),
    getVoice(meditation.voice_id),
  ]);

  return { meditation, segments, cues, voice };
}

export async function listLedger(userId: string, limit = 8): Promise<LedgerEntry[]> {
  // `*` y no la lista de columnas: así el historial se sigue leyendo aunque el
  // código llegue antes que la migración que agrega reason_key/reason_meta.
  // Las filas sin clave caen al texto guardado en `reason`.
  const { data } = await db()
    .from("omtana_credit_ledger")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as LedgerEntry[]) ?? [];
}

export async function userStats(userId: string) {
  const [plays, own] = await Promise.all([
    db()
      .from("omtana_plays")
      .select("seconds_listened, completed")
      .eq("user_id", userId)
      .then((r) => (r.data as { seconds_listened: number; completed: boolean }[]) ?? []),
    db()
      .from("omtana_meditations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .then((r) => r.count ?? 0),
  ]);

  const seconds = plays.reduce((n, p) => n + p.seconds_listened, 0);
  return {
    completed: plays.filter((p) => p.completed).length,
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    owned: own,
  };
}

/** Cuántas personalizaciones le quedan a este usuario, sin comprar nada. */
export function remainingFree(user: User): number {
  if (user.plan === "pro") return Infinity;
  return Math.max(0, PLAN.free.monthlyCustomizations - user.free_used_period);
}

export function canGenerate(user: User): boolean {
  return user.plan === "pro" || remainingFree(user) > 0 || user.credits > 0;
}
