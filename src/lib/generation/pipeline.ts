import { db } from "../supabase-client";
import { downloadAudio, ensureBucket, uploadAudio } from "../storage";
import { planSession } from "../session-plan";
import { writeScript } from "./script";
import { synthesize } from "./tts";
import { assemble, ensureFfmpeg, type SegmentInput } from "./audio";
import { ensureTemplate, PLAN_VERSION } from "./template";
import { claimJob, failGeneration } from "./jobs";
import { breathingSlotSeconds } from "../breathing";
import { logEvent, withTrace } from "../telemetry";
import { scriptAsPlainText, splitScript } from "./custom-script";
import type { ScriptResult } from "./script";
import { channelOf, type BreathingRender, type Intention, type Meditation, type MusicTrack, type Voice } from "../types";

type LoadedMeditation = Meditation & {
  intention: Intention | null;
  voice: Voice | null;
  music: MusicTrack | null;
};

type Step = (s: string) => Promise<void>;

export interface GenerateOptions {
  onStep?: (step: string) => void;
}

/**
 * Genera una meditación completa y la deja lista para escuchar.
 *
 * Los bloques fijos vienen de la plantilla (ya sintetizados); solo el tramo con
 * el contexto de la persona pasa por el modelo y por la síntesis de voz. Por eso
 * una meditación de 15 minutos se arma en menos de un minuto.
 */
export async function generateMeditation(
  meditationId: string,
  opts: GenerateOptions = {},
): Promise<void> {
  const { data } = await db()
    .from("omtana_meditations")
    .select("*, intention:omtana_intentions(*), voice:omtana_voices(*), music:omtana_music_tracks(*)")
    .eq("id", meditationId)
    .maybeSingle();

  if (!data) throw new Error(`No existe la meditación ${meditationId}.`);
  const meditation = data as LoadedMeditation;

  // Todo lo que se gaste adentro —modelo, voz, la plantilla que se arme de
  // paso— queda colgado de esta sesión y de quien la pidió.
  return withTrace(
    {
      meditationId,
      userId: meditation.user_id,
      via: channelOf(meditation),
    },
    () => generateLoaded(meditation, opts),
  );
}

async function generateLoaded(meditation: LoadedMeditation, opts: GenerateOptions): Promise<void> {
  const meditationId = meditation.id;
  const startedAt = Date.now();
  let previous: { step: string; at: number } | null = null;

  /*
   * Cada paso queda en el job (lo que ve quien espera) y en la bitácora con su
   * hora, que es de donde sale la traza: cuánto tardó cada paso.
   */
  const step: Step = async (s) => {
    opts.onStep?.(s);
    const now = Date.now();
    await db()
      .from("omtana_generation_jobs")
      .update({ step: s })
      .eq("meditation_id", meditationId)
      .eq("status", "running");
    await logEvent({
      source: "generation",
      message: `paso: ${s}`,
      data: {
        step: s,
        previous: previous?.step ?? null,
        previous_ms: previous ? now - previous.at : null,
        elapsed_ms: now - startedAt,
      },
    });
    previous = { step: s, at: now };
  };

  if (meditation.script_mode === "completo" && meditation.script_override?.trim()) {
    await generateFromOwnScript(meditation, step);
    await step("listo");
    return;
  }

  const voice = meditation.voice;
  if (!voice) throw new Error("La meditación no tiene voz asignada.");
  if (!voice.provider_voice_id) {
    throw new Error(
      `La voz "${voice.name}" no tiene provider_voice_id. Corre "npm run voices:link".`,
    );
  }

  const durationMinutes = Math.max(5, Math.round(meditation.duration_seconds / 60) || 15);

  /*
   * La respiración no se genera acá: es una pista pregenerada (`npm run
   * respiracion`) que el reproductor pone antes de la meditación. Lo único que
   * el motor necesita saber es cuánto dura, para descontárselo al cuerpo y que
   * la sesión mida lo que la persona pidió. Lo que el ejercicio no ocupa del
   * hueco se lo queda el tramo personalizado.
   */
  const breathingSeconds = await breathingLength(meditation, durationMinutes);
  const plan = planSession(durationMinutes, breathingSeconds);

  // Antes que nada: sin ffmpeg no hay mezcla posible, y todo lo que viene
  // después cuesta plata. Que falle acá y no al final.
  await ensureFfmpeg();
  await ensureBucket();

  /* 1 ─ Plantilla: bloques fijos, generados una vez por intención/voz/duración. */
  await step("plantilla");
  const intention: Intention = meditation.intention ?? {
    id: meditation.intention_id ?? "",
    slug: "libre",
    title: meditation.intention_text,
    summary: "",
    tag: "",
    category: "libre",
    durations: [durationMinutes],
    brief: meditation.intention_text,
    sort: 0,
    active: true,
  };

  if (!intention.id) {
    // Intención escrita a mano: se registra para que la próxima reutilice plantilla.
    const slug = slugify(meditation.intention_text);
    const { data: created } = await db()
      .from("omtana_intentions")
      .upsert(
        {
          slug,
          title: meditation.intention_text.slice(0, 90),
          brief: meditation.intention_text,
          tag: "Tuya",
          category: "libre",
          durations: [5, 10, 15, 20],
          sort: 900,
        },
        { onConflict: "slug" },
      )
      .select("*")
      .single();

    if (created) {
      Object.assign(intention, created as Intention);
      await db()
        .from("omtana_meditations")
        .update({ intention_id: intention.id })
        .eq("id", meditationId);
    }
  }

  const { templateId, sections } = await ensureTemplate(
    intention,
    meditation.locale,
    durationMinutes,
    voice,
    { onStep: opts.onStep },
  );

  /* 2 ─ Guion del tramo personalizado: lo escribe el modelo, o lo trajo la persona. */
  await step("guion");
  const script =
    meditation.script_mode === "tramo" && meditation.script_override?.trim()
      ? ownSegment(meditation, plan)
      : await writeScript({
          intention: meditation.intention_text,
          context: meditation.context_text,
          locale: meditation.locale,
          voiceName: voice.name,
          sections: plan,
        });

  /* 3 ─ Síntesis de voz, solo de lo nuevo. */
  const inputs: SegmentInput[] = [];
  const texts: Record<number, string> = {};

  for (const section of plan) {
    const templated = sections.find((s) => s.position === section.position);

    if (section.kind === "fixed" && templated?.audio_path) {
      texts[section.position] = templated.script_text ?? "";
      inputs.push({
        position: section.position,
        audio: await downloadAudio(templated.audio_path),
        targetSeconds: section.seconds,
      });
      continue;
    }

    const text = script.segments[section.position];
    if (!text) continue;
    await step(`voz:${section.position}`);
    const mp3 = await synthesize({
      voiceId: voice.provider_voice_id,
      text,
      settings: voice.provider_settings,
    });
    texts[section.position] = text;
    inputs.push({
      position: section.position,
      audio: mp3,
      targetSeconds: section.seconds,
    });
  }

  /* 4 ─ Mezcla con la música de fondo. */
  await step("mezcla");
  const music = meditation.music ? await downloadAudio(meditation.music.audio_path) : null;
  const assembled = await assemble(inputs, music);

  const audioPath = await uploadAudio(
    `meditations/${meditationId}/session.mp3`,
    assembled.mp3,
  );

  /* 5 ─ Persistir tramos, palabras en pantalla y estado final. */
  await step("guardado");
  await db().from("omtana_meditation_segments").delete().eq("meditation_id", meditationId);
  await db()
    .from("omtana_meditation_segments")
    .insert(
      assembled.segments.map((s) => {
        const section = plan.find((p) => p.position === s.position)!;
        return {
          meditation_id: meditationId,
          position: s.position,
          kind: section.kind,
          label: section.label,
          script_text: texts[s.position] ?? "",
          start_offset_seconds: s.startOffsetSeconds,
          seconds: s.seconds,
        };
      }),
    );

  await db().from("omtana_meditation_cues").delete().eq("meditation_id", meditationId);
  const cues = spreadCues(script.keywords, assembled.totalSeconds);
  if (cues.length) {
    await db()
      .from("omtana_meditation_cues")
      .insert(cues.map((c) => ({ ...c, meditation_id: meditationId })));
  }

  await db()
    .from("omtana_meditations")
    .update({
      title: meditation.title || script.title,
      template_id: templateId,
      audio_path: audioPath,
      duration_seconds: assembled.totalSeconds,
      keywords: script.keywords,
      breathing_slot_seconds: breathingSlotSeconds(durationMinutes),
      plan_version: PLAN_VERSION,
      status: "ready",
      ready_at: new Date().toISOString(),
    })
    .eq("id", meditationId);

  await step("listo");
}

/**
 * El tramo personalizado con el texto de la persona. Va a la primera sección
 * dinámica del reparto (hoy hay una sola) y no lleva palabras en pantalla: no
 * hay modelo que las elija.
 */
function ownSegment(meditation: Meditation, plan: ReturnType<typeof planSession>): ScriptResult {
  const dynamic = plan.find((s) => s.kind === "dynamic");
  if (!dynamic) throw new Error("El reparto de esta duración no tiene tramo personalizado.");
  return {
    title: meditation.title,
    segments: { [dynamic.position]: scriptAsPlainText(meditation.script_override ?? "") },
    keywords: [],
  };
}

/**
 * Una meditación cuyo guion entero es el de la persona: sin plantilla y sin
 * modelo. El texto se parte en bloques (`splitScript`), cada uno se graba con
 * la voz elegida y entre bloques queda el silencio que la persona marcó con
 * `[pausa N]`. Dura lo que dura su texto, no una de las duraciones del menú.
 */
async function generateFromOwnScript(meditation: LoadedMeditation, step: Step): Promise<void> {
  const voice = meditation.voice;
  if (!voice) throw new Error("La meditación no tiene voz asignada.");
  if (!voice.provider_voice_id) {
    throw new Error(
      `La voz "${voice.name}" no tiene provider_voice_id. Corre "npm run voices:link".`,
    );
  }

  const blocks = splitScript(meditation.script_override ?? "");
  if (blocks.length === 0) throw new Error("El guion vino vacío.");

  await ensureFfmpeg();
  await ensureBucket();

  const inputs: SegmentInput[] = [];
  for (const [i, block] of blocks.entries()) {
    await step(`voz:${i}`);
    const mp3 = await synthesize({
      voiceId: voice.provider_voice_id,
      text: block.text,
      settings: voice.provider_settings,
    });
    inputs.push({ position: i, audio: mp3, targetSeconds: 0, trailingSilenceSeconds: block.pauseAfter });
  }

  await step("mezcla");
  const music = meditation.music ? await downloadAudio(meditation.music.audio_path) : null;
  const assembled = await assemble(inputs, music);
  const audioPath = await uploadAudio(`meditations/${meditation.id}/session.mp3`, assembled.mp3);

  await step("guardado");
  await db().from("omtana_meditation_segments").delete().eq("meditation_id", meditation.id);
  await db()
    .from("omtana_meditation_segments")
    .insert(
      assembled.segments.map((s) => ({
        meditation_id: meditation.id,
        position: s.position,
        kind: "dynamic",
        label: "Tu guion",
        script_text: blocks[s.position]?.text ?? "",
        start_offset_seconds: s.startOffsetSeconds,
        seconds: s.seconds,
      })),
    );
  await db().from("omtana_meditation_cues").delete().eq("meditation_id", meditation.id);

  await db()
    .from("omtana_meditations")
    .update({
      audio_path: audioPath,
      duration_seconds: assembled.totalSeconds,
      plan_version: PLAN_VERSION,
      status: "ready",
      ready_at: new Date().toISOString(),
    })
    .eq("id", meditation.id);
}

/**
 * Cuánto ocupa la respiración elegida, según el audio que ya existe.
 *
 * Se lee del render y no del ejercicio: el render es el archivo que va a sonar,
 * y si no está — porque nadie lo generó para esta voz — la sesión se arma sin
 * respiración en vez de reservar un hueco que nadie va a llenar.
 */
async function breathingLength(
  meditation: Meditation,
  durationMinutes: number,
): Promise<number> {
  if (!meditation.breathing_exercise_id || !meditation.voice_id) return 0;

  const { data } = await db()
    .from("omtana_breathing_renders")
    .select("seconds")
    .eq("exercise_id", meditation.breathing_exercise_id)
    .eq("voice_id", meditation.voice_id)
    .eq("locale", meditation.locale)
    .eq("slot_seconds", breathingSlotSeconds(durationMinutes))
    .maybeSingle();

  return (data as Pick<BreathingRender, "seconds"> | null)?.seconds ?? 0;
}

/** Reparte las palabras clave por el cuerpo de la sesión, sin tocar los extremos. */
function spreadCues(keywords: string[], totalSeconds: number) {
  if (keywords.length === 0) return [];
  const start = Math.round(totalSeconds * 0.12);
  const end = Math.round(totalSeconds * 0.88);
  const gap = (end - start) / keywords.length;
  return keywords.map((word, i) => ({
    word,
    at_seconds: Math.round(start + gap * i),
  }));
}

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "intencion";
}

/**
 * Envuelve la generación marcando el job y el estado de la meditación.
 *
 * Devuelve "skipped" si el job ya no estaba en cola: otra invocación lo tomó
 * (Netlify reintenta las funciones en segundo plano) o el barrido lo dio por
 * perdido. Si falla, queda registrado y sale el aviso al equipo antes de
 * relanzar el error.
 */
export async function runGenerationJob(
  meditationId: string,
  jobId: string,
): Promise<"done" | "skipped"> {
  if (!(await claimJob(jobId))) return "skipped";

  try {
    await db()
      .from("omtana_meditations")
      .update({ status: "generating" })
      .eq("id", meditationId);

    await withTrace({ jobId }, () => generateMeditation(meditationId));
    await db()
      .from("omtana_generation_jobs")
      .update({ status: "done", step: "listo", finished_at: new Date().toISOString() })
      .eq("id", jobId);
    return "done";
  } catch (err) {
    await withTrace({ meditationId, jobId }, () =>
      failGeneration({ meditationId, jobId, error: err }),
    );
    throw err;
  }
}
