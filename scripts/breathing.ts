/**
 * Graba los ejercicios de respiración y comprueba que quedaron a tiempo.
 *
 *   npm run respiracion -- --listar                     qué hay en el banco y qué está grabado
 *   npm run respiracion -- --guion --ejercicio 4-7-8    la grilla, segundo a segundo, sin gastar nada
 *   npm run respiracion -- --voz aurora                 graba todo lo que le falte a esa voz
 *   npm run respiracion -- --voz aurora --ejercicio 4-7-8 --idioma es --hueco 120
 *   npm run respiracion -- --voz aurora --verificar     mide los audios ya grabados
 *   npm run respiracion -- --voz aurora --rehacer       rearma aunque ya existan
 *   npm run respiracion -- --voz aurora --regrabar      además vuelve a sintetizar las señales
 *   npm run respiracion -- --voz aurora --guardar tmp   deja una copia local para escucharla
 *   npm run respiracion -- --voz aurora --pronunciar "siete,siéte,ciete"
 *                                                       compara grafías de una palabra a oído
 *
 * Por qué a mano y no dentro de la meditación: el conteo tiene que caer en el
 * segundo. Cuando la respiración era un bloque de guion más, la voz leía "uno,
 * dos, tres, cuatro" al ritmo que le salía y el cuatro llegaba antes que el
 * cuarto segundo. Acá cada señal se pega en su milisegundo exacto sobre una
 * base de silencio, y después se vuelve a medir el archivo para confirmarlo.
 */
import "./_bootstrap";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { log, requireEnv, parseArgs, fatal, type Args } from "./_bootstrap";
import { db } from "../src/lib/supabase";
import { downloadAudio, ensureBucket, uploadAudio } from "../src/lib/storage";
import { synthesize } from "../src/lib/generation/tts";
import { durationOf, ensureFfmpeg, run, FFMPEG_BIN } from "../src/lib/generation/audio";
import {
  assembleBreathing,
  measure,
  mixBreathSounds,
  extractLast,
  overlaps,
  trimEdges,
  type Measurement,
} from "../src/lib/generation/breathing-audio";
import {
  cuePath,
  cycleSeconds,
  planBreathing,
  renderPath,
  renderVoicePath,
  type BreathingExercise,
  type BreathingPlan,
} from "../src/lib/breathing";
import { LOCALES } from "../src/lib/config";
import type { BreathingRender, Voice } from "../src/lib/types";

/** Los huecos que reserva la sesión: 150 s desde los 15 min, 120 s bajo eso. */
const SLOTS = [120, 150];

/**
 * Ritmo al que se graban las señales sueltas.
 *
 * Las voces leen la meditación a 0.82, que es un ritmo de narración. Una
 * palabra suelta a esa velocidad se arrastra — "cuatro" dura 1,1 s — y suena a
 * cámara lenta, no a calma. Contar es otra cosa que narrar: va a ritmo normal,
 * y la calma la da el silencio entre señal y señal. La entrada y el cierre, que
 * sí son prosa, se quedan con el ritmo de la voz.
 */
const CUE_SPEED = 1;

async function main() {
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const args = parseArgs();

  const exercises = await loadExercises(args);
  const locales = pickLocales(args);
  const slots = pickSlots(args);

  if (args.flags.has("guion")) return printScripts(exercises, locales, slots);
  if (args.flags.has("listar")) return listBank(exercises);
  if (args.values.has("pronunciar")) return tryPronunciations(args);

  const voice = await pickVoice(args);
  const verifyOnly = args.flags.has("verificar");
  if (!verifyOnly) requireEnv("ELEVENLABS_API_KEY");

  await ensureFfmpeg();
  await ensureBucket();

  log.title(`${verifyOnly ? "Verificando" : "Grabando"} · ${voice.name}`);

  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const exercise of exercises) {
    for (const locale of locales) {
      for (const slot of slots) {
        const plan = planBreathing(exercise, locale, slot);
        const tag = `${exercise.slug} · ${locale} · hueco ${slot}s`;

        if (!plan) {
          log.info(`${tag} — no entra en el hueco, se salta`);
          skipped++;
          continue;
        }

        try {
          const existing = await findRender(exercise.id, voice.id, locale, slot);

          if (verifyOnly) {
            if (!existing) {
              log.warn(`${tag} — no está grabado`);
              skipped++;
              continue;
            }
            // Para saber si el banco cambió hay que comparar con las mismas
            // medidas con las que se grabó, no con las estimaciones: si no,
            // toda grabación con entrada medida parecería desactualizada.
            const asRecorded =
              planBreathing(exercise, locale, slot, {
                lead: existing.steps[0]?.seconds,
                tail: existing.steps[existing.steps.length - 1]?.seconds,
              }) ?? plan;
            await verifyRender(existing, asRecorded, tag, args);
            done++;
            continue;
          }

          if (existing && !args.flags.has("rehacer") && !args.flags.has("regrabar")) {
            log.info(`${tag} — ya está grabado, se salta`);
            skipped++;
            continue;
          }

          await renderOne(exercise, voice, locale, slot, plan, tag, args);
          done++;
        } catch (err) {
          failed++;
          log.fail(`${tag} — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  log.done(
    `${done} ${verifyOnly ? "verificados" : "grabados"}` +
      `${skipped ? `, ${skipped} saltados` : ""}${failed ? `, ${failed} con error` : ""}.`,
  );
}

/* ───────────────────────────── el banco ───────────────────────────── */

async function loadExercises(args: Args): Promise<BreathingExercise[]> {
  const { data } = await db()
    .from("omtana_breathing_exercises")
    .select("*")
    .eq("active", true)
    .order("sort");

  const all = (data as BreathingExercise[]) ?? [];
  if (all.length === 0) fatal("No hay ejercicios de respiración. Corre primero: npm run seed");

  const slug = args.values.get("ejercicio");
  if (!slug) return all;

  const found = all.find((e) => e.slug === slug);
  if (!found) {
    fatal(`No existe el ejercicio "${slug}". Hay: ${all.map((e) => e.slug).join(", ")}`);
  }
  return [found];
}

function pickLocales(args: Args): string[] {
  const locale = args.values.get("idioma");
  if (!locale) return ["es"];
  if (locale === "todos") return LOCALES.map((l) => l.code);
  if (!LOCALES.some((l) => l.code === locale)) {
    fatal(`Idioma inválido: ${locale}. Usa ${LOCALES.map((l) => l.code).join(", ")} o "todos".`);
  }
  return [locale];
}

function pickSlots(args: Args): number[] {
  const raw = args.values.get("hueco");
  if (!raw) return SLOTS;
  const slot = Number(raw);
  if (!SLOTS.includes(slot)) fatal(`Hueco inválido: ${raw}. Usa ${SLOTS.join(" o ")}.`);
  return [slot];
}

async function pickVoice(args: Args): Promise<Voice> {
  const { data } = await db()
    .from("omtana_voices")
    .select("*")
    .eq("active", true)
    .order("sort");

  const voices = (data as Voice[]) ?? [];
  const slug = args.values.get("voz");

  if (!slug) {
    fatal(
      "Falta la voz.\n" +
        `    npm run respiracion -- --voz ${voices[0]?.slug ?? "aurora"}\n` +
        `    Disponibles: ${voices.map((v) => v.slug).join(", ")}`,
    );
  }

  const voice = voices.find((v) => v.slug === slug);
  if (!voice) {
    fatal(`No existe la voz "${slug}". Disponibles: ${voices.map((v) => v.slug).join(", ")}`);
  }
  if (!voice.provider_voice_id) {
    fatal(`La voz "${voice.name}" no está enlazada con ElevenLabs. Corre: npm run voices:link`);
  }
  return voice;
}

async function findRender(
  exerciseId: string,
  voiceId: string,
  locale: string,
  slot: number,
): Promise<BreathingRender | null> {
  const { data } = await db()
    .from("omtana_breathing_renders")
    .select("*")
    .eq("exercise_id", exerciseId)
    .eq("voice_id", voiceId)
    .eq("locale", locale)
    .eq("slot_seconds", slot)
    .maybeSingle();
  return (data as BreathingRender) ?? null;
}

/* ───────────────────────── el guion, sin gastar nada ───────────────────────── */

function listBank(exercises: BreathingExercise[]) {
  log.title("Ejercicios de respiración");

  for (const exercise of exercises) {
    const cycle = cycleSeconds(exercise);
    const pattern = exercise.phases.map((p) => p.seconds).join("-");
    log.step(`${exercise.slug} · ${pattern} · ciclo de ${cycle}s`);
    log.info(exercise.summary);
    for (const slot of SLOTS) {
      const plan = planBreathing(exercise, "es", slot);
      log.info(
        plan
          ? `hueco ${slot}s → ${plan.cycles} ciclos, dura ${clock(plan.seconds)}`
          : `hueco ${slot}s → no entra`,
      );
    }
  }

  log.done("Para grabarlos: npm run respiracion -- --voz aurora");
}

function printScripts(exercises: BreathingExercise[], locales: string[], slots: number[]) {
  for (const exercise of exercises) {
    for (const locale of locales) {
      for (const slot of slots) {
        const plan = planBreathing(exercise, locale, slot);
        log.title(`${exercise.slug} · ${locale} · hueco ${slot}s`);
        if (!plan) {
          log.warn("No entra en este hueco.");
          continue;
        }
        printTimeline(plan);
        log.info(`${plan.cycles} ciclos · dura ${clock(plan.seconds)} de ${slot}s`);
      }
    }
  }
}

function printTimeline(plan: BreathingPlan, drift?: Measurement["drift"]) {
  const mark: Record<string, string> = {
    lead: "▸", phase: "●", count: "·", aside: "♦", tail: "▸",
  };

  for (const cue of plan.cues) {
    const measured = drift?.get(cue.at);
    const tail =
      drift === undefined
        ? ""
        : measured === "pegada"
          ? "   pegada a la anterior"
          : measured === null || measured === undefined
            ? "   SIN SEÑAL"
            : `   ${measured >= 0 ? "+" : ""}${measured.toFixed(2)}s`;
    console.log(
      `    ${clock(cue.at).padStart(5)}  ${mark[cue.kind]} ${cue.text}${tail}`,
    );
  }
}

/**
 * Graba la misma palabra escrita de varias formas, una tras otra, para elegir
 * a oído cuál lee bien la voz.
 *
 * Es la herramienta de `pronounce`: "siete" salía "sete" y no hay forma de
 * saber desde acá qué grafía lo arregla — hay que escucharlas. Quedan en un
 * solo archivo, separadas por silencio y en el orden en que se pidieron.
 */
async function tryPronunciations(args: Args) {
  requireEnv("ELEVENLABS_API_KEY");
  await ensureFfmpeg();

  const voice = await pickVoice(args);
  const inPhrase = args.flags.has("en-frase");
  const spellings = (args.values.get("pronunciar") ?? "")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);

  if (spellings.length === 0) fatal('Pasa las grafías: --pronunciar "siete,siéte,ciete"');

  log.title(`Pronunciación · ${voice.name}${inPhrase ? " · dentro de una frase" : ""}`);

  const dir = await mkdtemp(join(tmpdir(), "omtana-say-"));
  try {
    const files: string[] = [];

    for (const [i, spelling] of spellings.entries()) {
      // En frase la voz tiene contexto y pronuncia distinto; después se recorta
      // la última palabra, que es la que interesa.
      const text = inPhrase
        ? `Cinco. Seis. ${spelling.charAt(0).toUpperCase()}${spelling.slice(1)}.`
        : `${spelling.charAt(0).toUpperCase()}${spelling.slice(1)}.`;
      log.step(`${i + 1}. ${JSON.stringify(text)}`);

      const raw = join(dir, `raw-${i}.mp3`);
      await writeFile(
        raw,
        await synthesize({
          voiceId: voice.provider_voice_id ?? "",
          text,
          settings: { ...voice.provider_settings, speed: CUE_SPEED },
        }),
      );

      const cut = join(dir, `cut-${i}.mp3`);
      if (inPhrase) await extractLast(raw, cut);
      const file = join(dir, `${i}.mp3`);
      await writeFile(file, await trimEdges(await readFile(inPhrase ? cut : raw)));
      files.push(file);

      // Una por archivo: escuchándolas sueltas se sabe cuál es cuál sin contar.
      await keepCopy(
        args,
        file,
        `${i + 1}-${slugify(spelling)}${inPhrase ? "-en-frase" : ""}.mp3`,
      );
    }

    // Y todas seguidas, para compararlas sin ir de archivo en archivo.
    const out = join(dir, "juntas.mp3");
    const filter = files
      .map((_, i) => `[${i}:a]adelay=${i * 2500}[d${i}]`)
      .concat(`${files.map((_, i) => `[d${i}]`).join("")}amix=inputs=${files.length}:normalize=0[out]`)
      .join(";");

    await run(FFMPEG_BIN, [
      "-y", ...files.flatMap((f) => ["-i", f]),
      "-filter_complex", filter,
      "-map", "[out]",
      "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "1",
      out,
    ]);

    await keepCopy(args, out, `todas${inPhrase ? "-en-frase" : ""}.mp3`);
    log.done(`${spellings.length} grafías, una por archivo y todas juntas.`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Nombre de archivo a partir de una grafía, tildes incluidas. */
function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "grafia";
}

/* ───────────────────────────── grabar ───────────────────────────── */

/**
 * El banco de señales de una voz: cada palabra sintetizada una sola vez.
 *
 * "Inhala" y los números son los mismos en todos los ejercicios, así que sumar
 * un ejercicio nuevo al banco no cuesta síntesis mientras reutilice el
 * vocabulario. Devuelve el audio de cada señal, ya en memoria.
 */
async function ensureCues(
  voice: Voice,
  locale: string,
  plan: BreathingPlan,
  force: boolean,
): Promise<Map<string, { audio: Buffer; seconds: number }>> {
  const needed = new Map<string, { speak: string; short: boolean }>();
  for (const cue of plan.cues) {
    if (needed.has(cue.slug)) continue;
    needed.set(cue.slug, {
      speak: cue.speak,
      short: cue.kind === "phase" || cue.kind === "count",
    });
  }

  const { data } = await db()
    .from("omtana_breathing_cues")
    .select("slug, text, audio_path, duration_seconds")
    .eq("voice_id", voice.id)
    .eq("locale", locale);

  const saved = new Map(
    ((data as { slug: string; text: string; audio_path: string; duration_seconds: number }[]) ?? [])
      .map((row) => [row.slug, row]),
  );

  const out = new Map<string, { audio: Buffer; seconds: number }>();
  const dir = await mkdtemp(join(tmpdir(), "omtana-cue-"));

  try {
    for (const [slug, { speak, short }] of needed) {
      const row = saved.get(slug);

      // El texto vive en el código: si cambió, la señal guardada ya no dice lo
      // que el guion promete y hay que volver a grabarla. Se compara contra lo
      // que se le pidió a la voz, que incluye la puntuación de la toma.
      if (row && row.text === speak && !force) {
        out.set(slug, {
          audio: await downloadAudio(row.audio_path),
          seconds: Number(row.duration_seconds),
        });
        continue;
      }

      log.info(`señal · ${slug}: ${JSON.stringify(speak)}`);
      const audio = await trimEdges(
        await synthesize({
          voiceId: voice.provider_voice_id ?? "",
          text: speak,
          settings: short
            ? { ...voice.provider_settings, speed: CUE_SPEED }
            : voice.provider_settings,
        }),
      );

      const file = join(dir, `${slug}.mp3`);
      await writeFile(file, audio);
      const seconds = await durationOf(file);
      const path = cuePath(voice.slug, locale, slug);
      await uploadAudio(path, audio);

      const { error } = await db().from("omtana_breathing_cues").upsert(
        {
          voice_id: voice.id,
          locale,
          slug,
          text: speak,
          audio_path: path,
          duration_seconds: seconds,
        },
        { onConflict: "voice_id,locale,slug" },
      );
      if (error) throw new Error(`No se guardó la señal ${slug}: ${error.message}`);

      out.set(slug, { audio, seconds });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return out;
}

async function renderOne(
  exercise: BreathingExercise,
  voice: Voice,
  locale: string,
  slot: number,
  planned: BreathingPlan,
  tag: string,
  args: Args,
) {
  log.step(`${tag} — ${planned.cycles} ciclos, ${clock(planned.seconds)}`);

  // `--rehacer` rearma el ejercicio; `--regrabar` además vuelve a sintetizar las
  // señales. Son cosas distintas: lo primero es gratis, lo segundo cuesta.
  const force = args.flags.has("regrabar");
  let plan = planned;
  let cues = await ensureCues(voice, locale, plan, force);

  /*
   * La entrada y el cierre duran lo que duran, y eso solo se sabe después de
   * grabarlos: la misma frase le toma diez segundos a una voz y catorce a otra.
   * Si no caben en los huecos estimados se replanifica con la medida real —
   * puede costar un ciclo, y es mejor que perder la mitad del cierre. Se repite
   * porque cambiar de ciclos cambia la frase de entrada, que vuelve a medirse.
   */
  for (let attempt = 0; attempt < 3; attempt++) {
    const spoken = {
      lead: length(cues, plan.cues[0]),
      tail: length(cues, plan.cues[plan.cues.length - 1]),
    };
    const first = plan.steps[0];
    const last = plan.steps[plan.steps.length - 1];
    if (spoken.lead <= first.seconds && spoken.tail <= last.seconds) break;

    const next = planBreathing(exercise, locale, slot, spoken);
    if (!next) {
      throw new Error(
        `La entrada dura ${spoken.lead}s y el cierre ${spoken.tail}s: ya no caben ` +
          `${exercise.min_cycles} ciclos en ${slot}s. Acorta las frases.`,
      );
    }

    log.info(
      `entrada ${spoken.lead}s y cierre ${spoken.tail}s medidos: ` +
        `${next.cycles} ciclos, ${clock(next.seconds)}`,
    );
    plan = next;
    // Sin `force`: lo que ya se grabó en esta corrida se reutiliza. Volver a
    // sintetizar la misma frase da una duración un poco distinta cada vez, así
    // que el bucle nunca convergía y pagaba una síntesis entera por vuelta.
    cues = await ensureCues(voice, locale, plan, false);
  }

  const problems = overlaps(plan, cues);
  for (const problem of problems) log.warn(problem);

  const dir = await mkdtemp(join(tmpdir(), "omtana-render-"));
  const voiceOnly = join(dir, "voz.mp3");
  const file = join(dir, "breathing.mp3");

  try {
    await assembleBreathing(plan, cues, voiceOnly);

    // Se mide la voz sola: el soplo de aire es continuo y taparía los silencios
    // que usa la verificación para encontrar cada señal.
    const report = await measure(voiceOnly, plan, problems);

    if (exercise.breath_sounds) {
      await mixBreathSounds(voiceOnly, plan, file);
    } else {
      await writeFile(file, await readFile(voiceOnly));
    }

    const path = renderPath(exercise.slug, voice.slug, locale, slot);
    await uploadAudio(path, await readFile(file));
    await uploadAudio(
      renderVoicePath(exercise.slug, voice.slug, locale, slot),
      await readFile(voiceOnly),
    );

    const { error } = await db().from("omtana_breathing_renders").upsert(
      {
        exercise_id: exercise.id,
        voice_id: voice.id,
        locale,
        slot_seconds: slot,
        cycles: plan.cycles,
        seconds: plan.seconds,
        audio_path: path,
        timeline: plan.cues,
        steps: plan.steps,
        checked_at: new Date().toISOString(),
        check_report: report.check,
      },
      { onConflict: "exercise_id,voice_id,locale,slot_seconds" },
    );
    if (error) throw new Error(`No se guardó el render: ${error.message}`);

    await keepCopy(args, file, `${exercise.slug}-${voice.slug}-${locale}-${slot}s.mp3`);
    announce(plan, report);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/* ───────────────────────────── verificar ───────────────────────────── */

/**
 * Mide un audio ya grabado contra **su propia** grilla.
 *
 * La del banco puede haber cambiado desde entonces — otra frase de entrada, otro
 * conteo — y medirlo contra la de hoy daba todo desfasado cuando el archivo
 * estaba perfecto. El render guarda su timeline justo para esto; que la
 * definición haya cambiado se avisa aparte, porque es otra cosa.
 */
async function verifyRender(
  render: BreathingRender,
  current: BreathingPlan,
  tag: string,
  args: Args,
) {
  log.step(tag);

  const plan: BreathingPlan = {
    cycles: render.cycles,
    cycleSeconds: current.cycleSeconds,
    seconds: render.seconds,
    cues: render.timeline,
    steps: render.steps,
  };

  if (plan.seconds !== current.seconds || plan.cues.length !== current.cues.length) {
    log.warn(
      `El banco cambió desde que se grabó (ahora serían ${current.cues.length} ` +
        `señales en ${clock(current.seconds)}). Vuelve a grabarlo con --rehacer.`,
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "omtana-verify-"));
  const file = join(dir, "breathing.mp3");

  try {
    // Se mide la capa de voz; si es una grabación anterior a que existiera, se
    // mide la mezcla y el soplo de aire se notará como señales "pegadas".
    const voiceOnly = render.audio_path.replace(/\.mp3$/, "-voz.mp3");
    const audio = await downloadAudio(voiceOnly).catch(() =>
      downloadAudio(render.audio_path),
    );
    await writeFile(file, audio);
    const report = await measure(file, plan);

    await db()
      .from("omtana_breathing_renders")
      .update({ checked_at: new Date().toISOString(), check_report: report.check })
      .eq("id", render.id);

    await keepCopy(args, file, `${render.audio_path.split("/").pop()}`);
    announce(plan, report);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function announce(plan: BreathingPlan, report: Measurement) {
  const { check } = report;

  if (check.problems.length === 0) {
    log.ok(
      `${clock(check.totalSeconds)} · ${check.cuesChecked} señales medidas, ` +
        `desfase máximo ${check.maxDriftSeconds.toFixed(2)}s` +
        (check.cuesGlued ? ` · ${check.cuesGlued} pegadas a la anterior` : ""),
    );
  } else {
    for (const problem of check.problems) log.fail(problem);
  }

  printTimeline(plan, report.drift);
}

/** Copia local para escuchar el resultado con tus propios oídos. */
async function keepCopy(args: Args, file: string, name: string) {
  const dir = args.values.get("guardar");
  if (!dir) return;
  const destination = join(dir, name);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(file));
  log.info(`copia en ${destination}`);
}

/** Segundos que ocupa una señal ya grabada, con un respiro de margen. */
function length(
  cues: Map<string, { seconds: number }>,
  cue: { slug: string },
): number {
  return Math.ceil((cues.get(cue.slug)?.seconds ?? 0) + 1);
}

function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
