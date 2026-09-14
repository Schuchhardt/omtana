/**
 * Genera meditaciones desde la línea de comandos.
 *
 *   npm run generate -- --intencion "Dormir sin dar vueltas" --duracion 10 --voz aurora
 *   npm run generate -- --i dormir-sin-dar-vueltas --contexto "Me despierto a las 4"
 *   npm run generate -- --respiracion caja-4-4-4-4   abre con ese ejercicio
 *   npm run generate -- --sin-respiracion            entra directo al cuerpo
 *   npm run generate -- --curated                 pregenera todo el banco, público
 *   npm run generate -- --curated --duracion 10   solo esa duración
 *   npm run generate -- --retry                   reintenta las que fallaron
 *
 * Es el mismo motor que usa la app: plantilla reutilizable + tramo escrito para
 * el caso. Lo que se genera acá con --curated queda en el catálogo público.
 */
import "./_bootstrap";
import { log, requireEnv, parseArgs, fatal } from "./_bootstrap";
import { db } from "../src/lib/supabase";
import { ensureBucket } from "../src/lib/storage";
import { generateMeditation } from "../src/lib/generation/pipeline";
import { breathingSlotSeconds, type BreathingExercise } from "../src/lib/breathing";
import { DURATIONS } from "../src/lib/config";
import type { Intention, Meditation, MusicTrack, Voice } from "../src/lib/types";

/** Los ejercicios que existen grabados con una voz, por idioma y hueco. */
interface BreathingOption {
  exercise_id: string;
  locale: string;
  slot_seconds: number;
}

async function main() {
  requireEnv(
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ELEVENLABS_API_KEY",
    "ANTHROPIC_API_KEY",
  );

  const args = parseArgs();
  await ensureBucket();

  const [voices, music, intentions, exercises] = await Promise.all([
    db().from("omtana_voices").select("*").eq("active", true).order("sort")
      .then((r) => (r.data as Voice[]) ?? []),
    db().from("omtana_music_tracks").select("*").eq("active", true)
      .then((r) => (r.data as MusicTrack[]) ?? []),
    db().from("omtana_intentions").select("*").eq("active", true).order("sort")
      .then((r) => (r.data as Intention[]) ?? []),
    db().from("omtana_breathing_exercises").select("*").eq("active", true).order("sort")
      .then((r) => (r.data as BreathingExercise[]) ?? []),
  ]);

  const linked = voices.filter((v) => v.provider_voice_id);
  if (linked.length === 0) {
    fatal("Ninguna voz está enlazada con ElevenLabs. Corre: npm run voices:link -- --auto");
  }

  if (args.flags.has("retry")) return retry();
  if (args.flags.has("curated")) return curated(args, linked, music, intentions, exercises);
  return single(args, linked, music, intentions, exercises);
}

/* ───────────────────────── una meditación ───────────────────────── */

async function single(
  args: ReturnType<typeof parseArgs>,
  voices: Voice[],
  music: MusicTrack[],
  intentions: Intention[],
  exercises: BreathingExercise[],
) {
  const slug = args.values.get("i");
  const fromBank = slug ? intentions.find((it) => it.slug === slug) : undefined;
  if (slug && !fromBank) {
    fatal(`No existe la intención "${slug}". Disponibles: ${intentions.map((i) => i.slug).join(", ")}`);
  }

  const intention = args.values.get("intencion") ?? fromBank?.title;
  if (!intention) {
    fatal(
      'Falta la intención.\n' +
        '    npm run generate -- --intencion "Calmar la ansiedad" --duracion 10',
    );
  }

  const duration = pickDuration(args.values.get("duracion"));
  const voice = pickVoice(voices, args.values.get("voz"));
  const track = pickMusic(music, args.values.get("musica"));
  const locale = args.values.get("idioma") ?? "es";

  // Lo que sale del CLI no tiene dueño, así que "privada" la dejaría invisible
  // para todos. El default es el catálogo público — es lo que produce el equipo.
  const visibility = args.flags.has("privada") ? "private" : "public";
  if (visibility === "private") {
    log.warn("--privada sin usuario dueño: no aparecerá en el catálogo ni en ninguna biblioteca.");
  }

  const breathing = await pickBreathing(args, exercises, voice, locale, duration);

  log.title(`Generando: ${intention}`);
  log.info(
    `${duration} min · ${voice.name} · ${locale} · ` +
      `respiración ${breathing?.slug ?? "ninguna"} · ${track?.name ?? "sin música"}`,
  );

  const id = await createMeditation({
    intentionId: fromBank?.id ?? null,
    title: intention,
    intentionText: intention,
    context: args.values.get("contexto") ?? "",
    locale,
    duration,
    voiceId: voice.id,
    musicId: track?.id ?? null,
    breathingId: breathing?.id ?? null,
    visibility,
    source: "curated",
  });

  await runOne(id, intention);
  log.done(`Lista: /reproductor/${id}`);
}

/* ───────────────────── banco inicial pregenerado ───────────────────── */

async function curated(
  args: ReturnType<typeof parseArgs>,
  voices: Voice[],
  music: MusicTrack[],
  intentions: Intention[],
  exercises: BreathingExercise[],
) {
  if (intentions.length === 0) fatal("No hay intenciones. Corre primero: npm run seed");

  const only = args.values.get("duracion") ? [pickDuration(args.values.get("duracion"))] : null;
  const voice = pickVoice(voices, args.values.get("voz"));
  const track = pickMusic(music, args.values.get("musica"));
  const locale = args.values.get("idioma") ?? "es";

  const jobs = intentions.flatMap((it) =>
    (only ?? it.durations).map((duration) => ({ intention: it, duration })),
  );

  log.title(`Pregenerando el banco · ${jobs.length} sesiones`);
  log.info(`Voz ${voice.name} · ${locale} · quedan públicas en el catálogo`);

  let ok = 0;
  let failed = 0;

  for (const [i, job] of jobs.entries()) {
    const tag = `[${i + 1}/${jobs.length}] ${job.intention.title} · ${job.duration} min`;

    // No repetimos lo que ya existe: --curated se puede correr de nuevo sin costo.
    //
    // La duración pedida no se puede comparar con `=`: `duration_seconds` guarda
    // el largo real del audio, que nunca cae justo en el múltiplo de 60 (una
    // sesión de 5 min termina midiendo 306s). Comparar contra `duration * 60`
    // dejaba esta rama muerta y cada corrida regeneraba el banco entero. Se
    // comparan minutos redondeados, que con duraciones de 5 en 5 no es ambiguo.
    const { data: candidates } = await db()
      .from("omtana_meditations")
      .select("id, duration_seconds")
      .eq("intention_id", job.intention.id)
      .eq("source", "curated")
      .eq("locale", locale)
      .eq("voice_id", voice.id)
      .eq("status", "ready");

    const existing = (candidates ?? []).find(
      (m) => Math.round(m.duration_seconds / 60) === job.duration,
    );

    if (existing) {
      log.info(`${tag} — ya existe, se salta`);
      continue;
    }

    log.step(tag);

    try {
      const breathing = await pickBreathing(args, exercises, voice, locale, job.duration);
      const id = await createMeditation({
        intentionId: job.intention.id,
        title: job.intention.title,
        intentionText: job.intention.title,
        context: job.intention.brief || job.intention.summary,
        locale,
        duration: job.duration,
        voiceId: voice.id,
        musicId: track?.id ?? null,
        breathingId: breathing?.id ?? null,
        visibility: "public",
        source: "curated",
      });
      await runOne(id, tag);
      ok++;
    } catch (err) {
      failed++;
      log.fail(`${tag} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log.done(`${ok} generadas${failed ? `, ${failed} con error` : ""}.`);
}

/* ───────────────────────── reintentos ───────────────────────── */

async function retry() {
  const { data } = await db()
    .from("omtana_meditations")
    .select("id, title")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(50);

  const failed = (data as Pick<Meditation, "id" | "title">[]) ?? [];
  if (failed.length === 0) {
    log.done("No hay meditaciones falladas.");
    return;
  }

  log.title(`Reintentando ${failed.length}`);
  for (const m of failed) {
    log.step(m.title);
    try {
      await runOne(m.id, m.title);
    } catch (err) {
      log.fail(`${m.title} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  log.done("Reintentos terminados.");
}

/* ───────────────────────── utilidades ───────────────────────── */

interface CreateInput {
  intentionId: string | null;
  title: string;
  intentionText: string;
  context: string;
  locale: string;
  duration: number;
  voiceId: string;
  musicId: string | null;
  breathingId: string | null;
  visibility: "private" | "public";
  source: "curated" | "user";
}

async function createMeditation(input: CreateInput): Promise<string> {
  const { data, error } = await db()
    .from("omtana_meditations")
    .insert({
      intention_id: input.intentionId,
      voice_id: input.voiceId,
      music_track_id: input.musicId,
      breathing_exercise_id: input.breathingId,
      breathing_slot_seconds: breathingSlotSeconds(input.duration),
      title: input.title.slice(0, 90),
      intention_text: input.intentionText,
      context_text: input.context,
      locale: input.locale,
      duration_seconds: input.duration * 60,
      source: input.source,
      visibility: input.visibility,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`No se pudo crear la meditación: ${error?.message}`);
  return data.id;
}

async function runOne(id: string, label: string): Promise<void> {
  const started = Date.now();
  await db().from("omtana_meditations").update({ status: "generating" }).eq("id", id);

  try {
    await generateMeditation(id, { onStep: (s) => log.info(s) });
    log.ok(`${label} — ${((Date.now() - started) / 1000).toFixed(0)}s`);
  } catch (err) {
    await db().from("omtana_meditations").update({ status: "failed" }).eq("id", id);
    throw err;
  }
}

function pickDuration(raw: string | undefined): number {
  const value = Number(raw ?? 15);
  if (!DURATIONS.includes(value as (typeof DURATIONS)[number])) {
    fatal(`Duración inválida: ${raw}. Usa una de ${DURATIONS.join(", ")}.`);
  }
  return value;
}

function pickVoice(voices: Voice[], slug: string | undefined): Voice {
  if (!slug) return voices[0];
  const found = voices.find((v) => v.slug === slug);
  if (!found) {
    fatal(`No hay voz enlazada con slug "${slug}". Disponibles: ${voices.map((v) => v.slug).join(", ")}`);
  }
  return found;
}

/**
 * Música mezclada dentro del archivo, solo si se pide.
 *
 * Antes venía por defecto. Dejó de venir cuando el reproductor aprendió a
 * ponerla en vivo: mezclada adentro no se puede bajar ni cambiar, y una sesión
 * sin música sirve para las dos cosas.
 */
function pickMusic(music: MusicTrack[], slug: string | undefined): MusicTrack | null {
  if (!slug || slug === "ninguna") return null;
  const found = music.find((m) => m.slug === slug);
  if (!found) fatal(`No hay música con slug "${slug}". Disponibles: ${music.map((m) => m.slug).join(", ")}`);
  return found;
}

/**
 * Con qué ejercicio abre la sesión.
 *
 * Solo sirve lo que ya está grabado con esta voz, este idioma y este hueco: el
 * audio de la respiración se pregenera a mano con `npm run respiracion`, y una
 * sesión que apunte a un ejercicio sin grabar abriría en silencio.
 */
async function pickBreathing(
  args: ReturnType<typeof parseArgs>,
  exercises: BreathingExercise[],
  voice: Voice,
  locale: string,
  duration: number,
): Promise<BreathingExercise | null> {
  if (args.flags.has("sin-respiracion")) return null;

  const slug = args.values.get("respiracion");
  if (slug === "ninguna") return null;

  const slot = breathingSlotSeconds(duration);
  const { data } = await db()
    .from("omtana_breathing_renders")
    .select("exercise_id, locale, slot_seconds")
    .eq("voice_id", voice.id)
    .eq("locale", locale)
    .eq("slot_seconds", slot);

  const grabados = new Set(((data as BreathingOption[]) ?? []).map((r) => r.exercise_id));
  const disponibles = exercises.filter((e) => grabados.has(e.id));

  if (disponibles.length === 0) {
    log.warn(
      `Sin respiración grabada para ${voice.slug}/${locale}/${slot}s. ` +
        `Grábala con: npm run respiracion -- --voz ${voice.slug}`,
    );
    return null;
  }

  if (!slug) return disponibles[0];

  const found = disponibles.find((e) => e.slug === slug);
  if (!found) {
    fatal(
      `No hay "${slug}" grabado para esta voz y duración. ` +
        `Disponibles: ${disponibles.map((e) => e.slug).join(", ")}`,
    );
  }
  return found;
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
