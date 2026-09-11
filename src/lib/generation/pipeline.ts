import { db } from "../supabase";
import { downloadAudio, ensureBucket, uploadAudio } from "../storage";
import { planSession } from "../session-plan";
import { writeScript } from "./script";
import { synthesize } from "./tts";
import { assemble, ensureFfmpeg, type SegmentInput } from "./audio";
import { ensureTemplate } from "./template";
import type { Intention, Meditation, MusicTrack, Voice } from "../types";

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
  const step = (s: string) => {
    opts.onStep?.(s);
    return db()
      .from("omtana_generation_jobs")
      .update({ step: s })
      .eq("meditation_id", meditationId)
      .eq("status", "running");
  };

  const { data } = await db()
    .from("omtana_meditations")
    .select("*, intention:omtana_intentions(*), voice:omtana_voices(*), music:omtana_music_tracks(*)")
    .eq("id", meditationId)
    .maybeSingle();

  if (!data) throw new Error(`No existe la meditación ${meditationId}.`);

  const meditation = data as Meditation & {
    intention: Intention | null;
    voice: Voice | null;
    music: MusicTrack | null;
  };

  const voice = meditation.voice;
  if (!voice) throw new Error("La meditación no tiene voz asignada.");
  if (!voice.provider_voice_id) {
    throw new Error(
      `La voz "${voice.name}" no tiene provider_voice_id. Corre "npm run voices:link".`,
    );
  }

  const durationMinutes = Math.max(5, Math.round(meditation.duration_seconds / 60) || 15);
  const plan = planSession(durationMinutes);

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

  /* 2 ─ Guion del tramo personalizado. */
  await step("guion");
  const script = await writeScript({
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
        targetSeconds: section.minutes * 60,
      });
      continue;
    }

    const text = script.segments[section.position];
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
      targetSeconds: section.minutes * 60,
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
      status: "ready",
      ready_at: new Date().toISOString(),
    })
    .eq("id", meditationId);
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

/** Envuelve la generación marcando el job y el estado de la meditación. */
export async function runGenerationJob(meditationId: string, jobId: string): Promise<void> {
  await db()
    .from("omtana_generation_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", jobId);
  await db()
    .from("omtana_meditations")
    .update({ status: "generating" })
    .eq("id", meditationId);

  try {
    await generateMeditation(meditationId);
    await db()
      .from("omtana_generation_jobs")
      .update({ status: "done", step: "listo", finished_at: new Date().toISOString() })
      .eq("id", jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db()
      .from("omtana_generation_jobs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", jobId);
    await db().from("omtana_meditations").update({ status: "failed" }).eq("id", meditationId);
    throw err;
  }
}
