/**
 * La semana, de punta a punta, desde tu máquina.
 *
 *   npm run semanal                          elige, genera la larga y renderiza 16:9 + 9:16
 *   npm run semanal -- --seco                dice qué haría y con qué comandos, sin gastar
 *   npm run semanal -- --publicar            además programa la publicación por Zernio
 *   npm run semanal -- --voz aurora --duracion 20
 *   npm run semanal -- --solo-render <id>    salta la generación: renderiza (y publica) esa
 *   npm run semanal -- --cortos-extra 1      suma el corto de una sesión vieja sin video
 *
 * Es la misma regla que en ci.ts: cada paso es un comando que también se puede
 * correr a mano, y se imprime antes de correrlo. Lo único que este script hace
 * por su cuenta es **elegir** — qué intención, qué duración, qué voz, qué
 * ejercicio y qué música — y crear la fila de la meditación. Generar, renderizar
 * y publicar lo hacen los scripts de siempre (`generate`, `video`, `zernio`).
 *
 * Por qué existe: el catálogo tenía 23 sesiones y ningún video publicado. El
 * problema no era el motor sino que nadie decidía cada semana cuál tocaba. Esto
 * decide con el informe de curaduría (`weeklyLongJob`), así que cada semana
 * sale la sesión larga del área que más falta le hace al banco.
 *
 * Correrlo cada lunes (a mano o con launchd/cron) es el equivalente local de la
 * tanda semanal que más adelante correrá en Netlify con el mismo código.
 */
import "./_bootstrap";
import { spawn } from "node:child_process";
import { log, requireEnv, parseArgs, fatal } from "./_bootstrap";
import { db } from "../src/lib/supabase";
import { ensureBucket } from "../src/lib/storage";
import { generateMeditation } from "../src/lib/generation/pipeline";
import { ensureFfmpeg } from "../src/lib/generation/audio";
import { balance, weeklyLongJob } from "../src/lib/curation/balance";
import { breathingSlotSeconds, type BreathingExercise } from "../src/lib/breathing";
import { DURATIONS } from "../src/lib/config";
import type { Intention, MusicTrack, Voice } from "../src/lib/types";

/** Duraciones que cuentan como "larga". Una de diez no llena un video de canal. */
const LONG_DURATIONS = [15, 20];

/** Lo que se renderiza cada semana. El 1:1 queda fuera: el 9:16 ya cubre las redes. */
const FORMATS = "youtube,vertical";

interface Pick {
  intention: Intention;
  duration: number;
  locale: string;
  voice: Voice;
  exercise: BreathingExercise | null;
  music: MusicTrack | null;
}

async function main() {
  const args = parseArgs();
  const dry = args.flags.has("seco");
  const onlyRender = args.values.get("solo-render") ?? null;
  const publish = args.flags.has("publicar");

  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  if (!dry && !onlyRender) requireEnv("ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY");
  if (!dry && publish) requireEnv("ZERNIO_API_KEY");
  if (!dry) await ensureFfmpeg();

  const locale = args.values.get("idioma") ?? "es";
  const extraShorts = Number(args.values.get("cortos-extra") ?? 0);
  if (!Number.isFinite(extraShorts) || extraShorts < 0) fatal("--cortos-extra espera un número.");

  log.title(`Semana ${isoWeek(new Date())}${dry ? " (en seco)" : ""}`);

  /* 1 ─ Qué sesión larga toca, o cuál se pidió. */
  let meditationId = onlyRender;
  let music: MusicTrack | null = null;

  if (onlyRender) {
    const { data } = await db()
      .from("omtana_meditations")
      .select("id, title, status, music:omtana_music_tracks(*)")
      .eq("id", onlyRender)
      .maybeSingle();
    if (!data) fatal(`No existe la meditación ${onlyRender}.`);
    if (data.status !== "ready") fatal(`La meditación ${onlyRender} está en "${data.status}", no lista.`);
    log.step(`Sin generar: se renderiza "${data.title}"`);
    music = one(data.music as MusicTrack | MusicTrack[] | null) ?? (await rotatingMusic());
  } else {
    const pick = await choose(args, locale);
    log.step(
      `${pick.intention.category} · ${pick.intention.title} · ${pick.duration} min · ${pick.locale}`,
    );
    log.info(
      `voz ${pick.voice.name} · respiración ${pick.exercise?.slug ?? "ninguna"} · ` +
        `música del video ${pick.music?.name ?? "ninguna"}`,
    );
    music = pick.music;

    if (dry) {
      log.info("(en seco: no se crea ni se genera nada)");
      meditationId = "<id-nuevo>";
    } else {
      await ensureBucket();
      meditationId = await createMeditation(pick);
      await generate(meditationId, pick.intention.title);
    }
  }

  /* 2 ─ Los cortos extra: sesiones públicas que todavía no tienen 9:16. */
  const backlog = extraShorts > 0 ? await withoutVertical(extraShorts, meditationId!) : [];
  if (extraShorts > 0) {
    log.step(`Cortos extra: ${backlog.length} de ${extraShorts} pedidos`);
    for (const row of backlog) log.info(`${row.title} (${row.id.slice(0, 8)})`);
  }

  /* 3 ─ Renderizar y, si se pide, publicar: los comandos de siempre. */
  const musicArgs = music ? ["--musica", music.slug] : [];
  const steps: { title: string; script: string; args: string[] }[] = [
    {
      title: `Renderizar ${FORMATS} de la sesión de la semana`,
      script: "scripts/video.ts",
      args: [meditationId!, "--formato", FORMATS, ...musicArgs],
    },
    ...backlog.map((row) => ({
      title: `Renderizar el corto de "${row.title}"`,
      script: "scripts/video.ts",
      args: [row.id, "--formato", "vertical", ...musicArgs],
    })),
  ];

  if (publish) {
    const ids = [meditationId!, ...backlog.map((row) => row.id)];
    const platforms = args.values.get("plataformas");
    steps.push({
      title: "Programar la publicación por Zernio (48 h de ventana para frenarla)",
      script: "scripts/publish-zernio.ts",
      args: [
        ...ids,
        "--en", args.values.get("en") ?? "48",
        ...(platforms ? ["--plataformas", platforms] : []),
      ],
    });
  }

  for (const step of steps) {
    log.step(step.title);
    log.info(`npx tsx --conditions=react-server ${step.script} ${step.args.join(" ")}`);
    if (dry) continue;
    const code = await run(step.script, step.args);
    if (code !== 0) fatal(`"${step.title}" terminó con código ${code}.`);
  }

  log.done(
    dry
      ? "Revisado. Quita --seco para correrlo."
      : `Semana lista · /reproductor/${meditationId} · archivos en out/video/`,
  );
}

/* ───────────────────────── la elección ───────────────────────── */

/**
 * Qué se genera esta semana.
 *
 * La intención y la duración salen del informe de curaduría: el primer hueco
 * largo del área más floja. La voz rota entre las que tienen grabado el
 * ejercicio de respiración para ese hueco — sin eso la sesión abriría en
 * silencio —, salvo que se fije una "voz de la casa" con --voz o con
 * OMTANA_WEEKLY_VOICE, que además reutiliza plantillas y sale más barato. El
 * ejercicio es el menos usado hasta ahora con esa voz, y la música del video
 * rota por semana para que el canal no suene siempre igual.
 */
async function choose(args: ReturnType<typeof parseArgs>, locale: string): Promise<Pick> {
  const durations = pickDurations(args.values.get("duracion"));

  const report = await balance();
  const job = weeklyLongJob(report, { durations });
  if (!job) {
    fatal(
      `El banco no tiene ningún hueco de ${durations.join(" o ")} minutos por generar.\n` +
        "    Amplía `durations` de alguna intención o aplica una propuesta de curaduría.",
    );
  }

  const { data: intentionRow } = await db()
    .from("omtana_intentions")
    .select("*")
    .eq("slug", job.intentionSlug)
    .maybeSingle();
  const intention = intentionRow as Intention | null;
  if (!intention) fatal(`La intención "${job.intentionSlug}" ya no está en el banco.`);

  const slot = breathingSlotSeconds(job.duration);
  const voice = await pickVoice(args.values.get("voz") ?? process.env.OMTANA_WEEKLY_VOICE, locale, slot);
  const exercise = await pickExercise(voice, locale, slot);
  const music = await rotatingMusic();

  return { intention, duration: job.duration, locale: job.locale, voice, exercise, music };
}

function pickDurations(raw: string | undefined): number[] {
  if (!raw || raw === "auto") return LONG_DURATIONS;
  const value = Number(raw);
  if (!DURATIONS.includes(value as (typeof DURATIONS)[number]) || !LONG_DURATIONS.includes(value)) {
    fatal(`--duracion espera ${LONG_DURATIONS.join(" o ")} (o auto).`);
  }
  return [value];
}

async function pickVoice(slug: string | undefined, locale: string, slot: number): Promise<Voice> {
  const { data: voiceRows } = await db()
    .from("omtana_voices")
    .select("*")
    .eq("active", true)
    .not("provider_voice_id", "is", null)
    .order("sort");
  const linked = (voiceRows as Voice[]) ?? [];
  if (linked.length === 0) fatal("No hay voces enlazadas. Corre: npm run voices:link -- --auto");

  if (slug) {
    const found = linked.find((v) => v.slug === slug);
    if (!found) fatal(`No hay voz enlazada "${slug}". Disponibles: ${linked.map((v) => v.slug).join(", ")}`);
    return found;
  }

  // Solo las voces que pueden abrir con respiración en este hueco e idioma.
  const { data: renders } = await db()
    .from("omtana_breathing_renders")
    .select("voice_id")
    .eq("locale", locale)
    .eq("slot_seconds", slot);
  const recorded = new Set(((renders as { voice_id: string }[]) ?? []).map((r) => r.voice_id));
  const eligible = linked.filter((v) => recorded.has(v.id) && v.languages.includes(locale));
  if (eligible.length === 0) {
    log.warn(`Ninguna voz tiene respiración grabada para ${locale}/${slot}s; se usa ${linked[0].name} sin respiración.`);
    return linked[0];
  }

  // Rotación: la que menos sesiones largas curadas tiene hasta ahora.
  const { data: usage } = await db()
    .from("omtana_meditations")
    .select("voice_id, duration_seconds, breathing_slot_seconds")
    .eq("source", "curated")
    .eq("status", "ready");
  const count = new Map<string, number>();
  for (const m of (usage as { voice_id: string; duration_seconds: number; breathing_slot_seconds: number | null }[]) ?? []) {
    const minutes = Math.round((m.duration_seconds + (m.breathing_slot_seconds ?? 0)) / 60);
    if (minutes < LONG_DURATIONS[0]) continue;
    count.set(m.voice_id, (count.get(m.voice_id) ?? 0) + 1);
  }
  eligible.sort((a, b) => (count.get(a.id) ?? 0) - (count.get(b.id) ?? 0) || a.sort - b.sort);
  return eligible[0];
}

async function pickExercise(voice: Voice, locale: string, slot: number): Promise<BreathingExercise | null> {
  const { data: renders } = await db()
    .from("omtana_breathing_renders")
    .select("exercise_id")
    .eq("voice_id", voice.id)
    .eq("locale", locale)
    .eq("slot_seconds", slot);
  const recorded = new Set(((renders as { exercise_id: string }[]) ?? []).map((r) => r.exercise_id));
  if (recorded.size === 0) return null;

  const { data: exerciseRows } = await db()
    .from("omtana_breathing_exercises")
    .select("*")
    .eq("active", true)
    .order("sort");
  const available = ((exerciseRows as BreathingExercise[]) ?? []).filter((e) => recorded.has(e.id));
  if (available.length === 0) return null;

  const { data: usage } = await db()
    .from("omtana_meditations")
    .select("breathing_exercise_id")
    .eq("source", "curated")
    .eq("status", "ready")
    .not("breathing_exercise_id", "is", null);
  const count = new Map<string, number>();
  for (const m of (usage as { breathing_exercise_id: string }[]) ?? []) {
    count.set(m.breathing_exercise_id, (count.get(m.breathing_exercise_id) ?? 0) + 1);
  }
  available.sort((a, b) => (count.get(a.id) ?? 0) - (count.get(b.id) ?? 0) || a.sort - b.sort);
  return available[0];
}

/** La pista de la semana: rota con el número de semana, así el canal no repite fondo. */
async function rotatingMusic(): Promise<MusicTrack | null> {
  const { data } = await db().from("omtana_music_tracks").select("*").eq("active", true).order("slug");
  const tracks = (data as MusicTrack[]) ?? [];
  if (tracks.length === 0) return null;
  const week = Number(isoWeek(new Date()).split("-W")[1]);
  return tracks[week % tracks.length];
}

/* ───────────────────────── crear y generar ───────────────────────── */

/**
 * La fila de la meditación, pública y curada: es la misma que crea
 * `npm run generate`. La música NO se guarda en la sesión — el reproductor la
 * pone en vivo — y solo se hornea en el video.
 */
async function createMeditation(pick: Pick): Promise<string> {
  const { data, error } = await db()
    .from("omtana_meditations")
    .insert({
      intention_id: pick.intention.id,
      voice_id: pick.voice.id,
      music_track_id: null,
      breathing_exercise_id: pick.exercise?.id ?? null,
      breathing_slot_seconds: breathingSlotSeconds(pick.duration),
      title: pick.intention.title.slice(0, 90),
      intention_text: pick.intention.title,
      context_text: pick.intention.brief || pick.intention.summary,
      locale: pick.locale,
      duration_seconds: pick.duration * 60,
      source: "curated",
      visibility: "public",
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`No se pudo crear la meditación: ${error?.message}`);
  return data.id;
}

async function generate(id: string, label: string): Promise<void> {
  const started = Date.now();
  log.step(`Generar "${label}"`);
  await db().from("omtana_meditations").update({ status: "generating" }).eq("id", id);
  try {
    await generateMeditation(id, { onStep: (s) => log.info(s) });
    log.ok(`${label} — ${((Date.now() - started) / 1000).toFixed(0)}s`);
  } catch (err) {
    await db().from("omtana_meditations").update({ status: "failed" }).eq("id", id);
    throw err;
  }
}

/* ───────────────────────── cortos extra ───────────────────────── */

/** Públicas, listas y sin 9:16, las más escuchadas primero. */
async function withoutVertical(limit: number, exclude: string): Promise<{ id: string; title: string }[]> {
  const { data } = await db()
    .from("omtana_meditations")
    .select("id, title, plays, video:omtana_video_exports(format, status)")
    .eq("visibility", "public")
    .eq("status", "ready")
    .eq("source", "curated")
    .order("plays", { ascending: false });

  const rows = (data as { id: string; title: string; video: { format: string; status: string }[] | null }[]) ?? [];
  return rows
    .filter((row) => row.id !== exclude)
    .filter((row) => !(row.video ?? []).some((v) => v.format === "vertical" && v.status === "ready"))
    .slice(0, limit)
    .map((row) => ({ id: row.id, title: row.title }));
}

/* ───────────────────────── plomería ───────────────────────── */

function run(script: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "--conditions=react-server", script, ...args], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** "2026-W40": lunes como primer día, según ISO 8601. */
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
