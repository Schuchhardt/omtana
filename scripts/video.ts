/**
 * Convierte una meditación en las piezas que se publican.
 *
 *   npm run video -- <id>                       los tres formatos
 *   npm run video -- <id> --formato vertical    solo el de redes
 *   npm run video -- <id> --pieza meditacion    el recorte sale de la meditación
 *   npm run video -- <id> --sin-cartas          el largo, sin presentación ni cierre
 *   npm run video -- <id> --muestra 25          borrador rápido, no sube nada
 *   npm run video -- --semanal 3                la tanda de la semana
 *   npm run video -- --catalogo                 todo lo público que no tenga video
 *
 * La escena es la del reproductor: fondo cálido que se mueve despacio, el disco
 * respirando con el ejercicio, la onda siguiendo la voz, el guion abajo como
 * subtítulo y el wordmark arriba. Lo que cambia entre formatos es el encuadre y
 * qué se muestra: el 16:9 lleva la sesión entera — respiración y meditación —,
 * y las piezas de redes llevan media vuelta de reloj de una sola de las dos.
 *
 * El video es distribución, no un extra: existe desde el día uno y esta es la
 * pieza que alimenta el canal.
 */
import "./_bootstrap";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { log, requireEnv, parseArgs, fatal, type Args } from "./_bootstrap";
import { db } from "../src/lib/supabase";
import { downloadAudio, ensureBucket, uploadAudio, FileTooLargeError } from "../src/lib/storage";
import { ensureFfmpeg } from "../src/lib/generation/audio";
import {
  ensureFonts,
  ensureLogo,
  FORMATS,
  FORMAT_IDS,
  layoutFor,
  slug,
  THEMES,
  type FormatId,
  type ThemeName,
} from "../src/lib/video/brand";
import { buildTrack, clipAudio, renderVideo } from "../src/lib/video/render";
import { renderBarMask, renderDisc } from "../src/lib/video/disc";
import {
  speechSpans,
  splitPhrases,
  tidy,
  timePhrases,
  toAss,
  toSrt,
  type Span,
  type SubtitleCue,
} from "../src/lib/video/subtitles";
import { cardCopy, videoCopy } from "../src/lib/video/copy";
import { breathingSlotSeconds, type BreathingCue, type BreathingStep } from "../src/lib/breathing";
import type { Intention, Meditation, MeditationSegment, MusicTrack, Voice } from "../src/lib/types";

/**
 * Volumen de la música dentro del archivo.
 *
 * Más bajo que el 0.35 que trae el reproductor: ahí la persona puede moverlo y
 * acá no, así que se elige el lado seguro — una música que tapa la voz arruina
 * la pieza y no hay forma de arreglarla sin volver a renderizar.
 */
const MUSIC_VOLUME = 0.26;

/**
 * Qué lleva una pieza: la sesión entera (16:9) o una sola cosa (redes).
 * "auto" es lo que se pide desde afuera y se resuelve acá adentro.
 */
type Piece = "completa" | "respiracion" | "meditacion";
type Asked = Piece | "auto";

interface Clip {
  from: number;
  length: number;
  piece: Piece;
}

interface BreathingPart {
  name: string;
  seconds: number;
  audio: string;
  steps: BreathingStep[];
  timeline: BreathingCue[];
}

async function main() {
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const args = parseArgs();

  await ensureFfmpeg();

  const formats = pickFormats(args.values.get("formato"));
  const theme = pickTheme(args.values.get("tema"));
  const outDir = resolve(args.values.get("salida") ?? "out/video");
  const sample = args.values.has("muestra") ? Number(args.values.get("muestra")) : null;
  if (sample !== null && (!Number.isFinite(sample) || sample <= 0)) {
    fatal(`--muestra espera segundos: --muestra 25`);
  }
  const upload = !args.flags.has("sin-subir") && sample === null;

  await mkdir(outDir, { recursive: true });
  if (upload) await ensureBucket();

  const piece = pickPiece(args.values.get("pieza"));

  const fonts = await ensureFonts();
  const targets = await pickTargets(args, formats);

  if (targets.length === 0) {
    fatal(
      "No hay nada que exportar.\n" +
        "    npm run video -- <id>\n" +
        "    npm run video -- --semanal 3\n" +
        "    npm run video -- --catalogo",
    );
  }

  log.title(
    `${targets.length} meditación${targets.length === 1 ? "" : "es"} · ` +
      `${formats.map((f) => FORMATS[f].label).join(", ")}`,
  );
  if (sample !== null) log.info(`Muestra de ${sample}s: borrador rápido, sin subir ni registrar.`);

  let ok = 0;
  let failed = 0;

  for (const [i, id] of targets.entries()) {
    try {
      await exportOne(id, {
        formats,
        theme,
        outDir,
        fonts,
        sample,
        upload,
        piece,
        cards: !args.flags.has("sin-cartas"),
        music: args.values.get("musica") ?? null,
        skipBreathing: args.flags.has("sin-respiracion"),
        tag: `[${i + 1}/${targets.length}]`,
      });
      ok++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      log.fail(`${id} — ${message}`);
      if (upload) await markFailed(id, formats, message);
    }
  }

  log.done(`${ok} lista${ok === 1 ? "" : "s"}${failed ? `, ${failed} con error` : ""} · ${outDir}`);
  if (failed > 0) process.exitCode = 1;
}

/* ───────────────────────── qué se exporta ───────────────────────── */

interface ExportOptions {
  formats: FormatId[];
  theme: ThemeName;
  outDir: string;
  fonts: { light: string; book: string };
  sample: number | null;
  upload: boolean;
  /** La pieza larga abre con una presentación y cierra con la marca. */
  cards: boolean;
  piece: Asked;
  music: string | null;
  skipBreathing: boolean;
  tag: string;
}

async function exportOne(id: string, opts: ExportOptions) {
  const { data } = await db()
    .from("omtana_meditations")
    .select(
      "*, voice:omtana_voices(*), intention:omtana_intentions(*), music:omtana_music_tracks(*)",
    )
    .eq("id", id)
    .maybeSingle();

  const meditation = data as
    | (Meditation & { voice: Voice | null; intention: Intention | null; music: MusicTrack | null })
    | null;

  if (!meditation) throw new Error("no existe");
  if (meditation.status !== "ready" || !meditation.audio_path) throw new Error("todavía no está lista");

  log.step(`${opts.tag} ${meditation.title}`);

  const work = await mkdtemp(join(tmpdir(), "omtana-video-"));

  try {
    /* 1 ─ Lo que suena: respiración (si va), meditación y música. */
    const breathing = opts.skipBreathing ? null : await loadBreathing(meditation, work);
    const body = join(work, "cuerpo.mp3");
    await writeFile(body, await downloadAudio(meditation.audio_path));

    const track = await pickMusic(meditation, opts.music, work);

    const full = await buildTrack({
      work,
      voices: breathing ? [breathing.audio, body] : [body],
      music: track?.file ?? null,
      musicVolume: MUSIC_VOLUME,
    });

    /*
     * La pieza larga lleva cartas, y eso le cambia el reloj: la sesión empieza
     * después de la presentación. Se arma una segunda pista con ese hueco —
     * reusando la voz ya concatenada, así que solo cuesta la mezcla — y los
     * recortes de redes siguen saliendo de la primera, que es la que va a
     * tiempo con los subtítulos.
     */
    const withCards =
      opts.cards && opts.sample === null && opts.formats.includes("youtube")
        ? await buildTrack({
            work,
            voices: [full.voice],
            music: track?.file ?? null,
            musicVolume: MUSIC_VOLUME,
            introSeconds: CARDS.intro,
            outroSeconds: CARDS.outro,
            label: "-cartas",
          })
        : null;

    /* 2 ─ Los subtítulos, medidos sobre la voz sola. */
    const segments = await loadSegments(id, breathing?.seconds ?? 0);
    const spans = await speechSpans(full.voice, full.voiceSeconds);
    const cues = tidy(
      [
        ...(breathing ? breathingCues(breathing, spans) : []),
        ...segments.flatMap((s) => timePhrases(s, spans, splitPhrases(s.text))),
      ],
      full.seconds,
    );

    /* 3 ─ Una pieza por formato. */
    const logoWidths = new Map<number, string>();

    for (const formatId of opts.formats) {
      const format = FORMATS[formatId];
      const layout = layoutFor(format);
      const theme = THEMES[opts.theme];

      const clip = pickClip({
        format: formatId,
        total: full.seconds,
        breathing,
        cues,
        sample: opts.sample,
        asked: opts.piece,
      });
      const cards = clip === null && withCards !== null;
      const audio = clip
        ? await clipAudio(work, full.file, clip.from, clip.length, formatId)
        : cards
          ? { file: withCards!.file, seconds: withCards!.seconds }
          : { file: full.file, seconds: full.seconds };

      // El reloj del video contra el de la sesión: los recortes empiezan más
      // adelante, y la pieza larga empieza antes, por la presentación.
      const from = clip ? clip.from : cards ? -CARDS.intro : 0;
      const piece = clip?.piece ?? "completa";
      const sessionSeconds = cards ? audio.seconds - CARDS.intro - CARDS.outro : audio.seconds;
      const localCues = shift(cues, from, audio.seconds);

      const assFile = join(work, `subs-${formatId}.ass`);
      await writeFile(
        assFile,
        toAss(localCues, { format, layout, theme, font: opts.fonts.light }),
      );

      const disc = await renderDisc({
        work: join(work, formatId),
        theme,
        radius: layout.discRadius,
        totalSeconds: sessionSeconds,
        steps: breathing?.steps ?? [],
        breathingSeconds: breathing?.seconds ?? 0,
        offsetSeconds: Math.max(0, from),
      });

      if (!logoWidths.has(layout.logoWidth)) {
        logoWidths.set(layout.logoWidth, await ensureLogo(theme, layout.logoWidth));
      }

      const name = `${slug(meditation.title)}-${id.slice(0, 8)}-${formatId}`;
      const out = join(opts.outDir, `${name}.mp4`);

      const barMask = await renderBarMask(
        join(work, formatId),
        layout.waveWidth,
        Math.round(layout.waveHeight / 2),
        layout.waveBars,
      );

      await renderVideo({
        audio: audio.file,
        seconds: audio.seconds,
        disc,
        logo: logoWidths.get(layout.logoWidth)!,
        barMask,
        subtitles: assFile,
        fontsDir: resolve("assets/fonts"),
        fontFile: opts.fonts.book,
        format,
        layout,
        theme,
        title: titleLine(meditation, breathing, piece),
        meta: metaLine(meditation, breathing, sessionSeconds, piece),
        cards: cards
          ? {
              intro: CARDS.intro,
              outro: CARDS.outro,
              copy: cardCopy({
                title: meditation.title,
                intentionSummary: meditation.intention?.summary ?? "",
                locale: meditation.locale,
                voiceName: meditation.voice?.name ?? "Omtana",
                durationMinutes: Math.round(sessionSeconds / 60),
                breathingName: breathing?.name ?? null,
                breathingSeconds: breathing?.seconds ?? 0,
              }),
              logo: await ensureLogo(theme, Math.round(format.width * 0.26)),
            }
          : null,
        out,
        draft: opts.sample !== null,
      });

      const srt = join(opts.outDir, `${name}.srt`);
      await writeFile(srt, toSrt(localCues));

      const copy = videoCopy({
        title: meditation.title,
        intentionSummary: meditation.intention?.summary ?? "",
        locale: meditation.locale,
        voiceName: meditation.voice?.name ?? "Omtana",
        durationMinutes: Math.round(sessionSeconds / 60),
        breathingName: breathing?.name ?? null,
        format: formatId,
        piece,
        chapters: chapters(breathing, segments, cards ? CARDS.intro : 0),
      });
      await writeFile(join(opts.outDir, `${name}.json`), `${JSON.stringify(copy, null, 2)}\n`);

      log.ok(
        `${FORMATS[formatId].label}${piece === "completa" ? "" : ` · ${piece} · ${Math.round(audio.seconds)}s`}` +
          ` → ${out}`,
      );

      if (opts.upload) {
        await record(id, formatId, {
          file: out,
          srt,
          seconds: Math.round(audio.seconds),
          width: format.width,
          height: format.height,
          theme: opts.theme,
          copy,
        });
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/* ───────────────────────── audio de entrada ───────────────────────── */

/**
 * El ejercicio con el que abre la sesión, si existe grabado.
 *
 * Es el mismo archivo y la misma grilla que usa el reproductor, así que el
 * disco del video respira exactamente igual que el de la pantalla.
 */
async function loadBreathing(
  meditation: Meditation & { voice: Voice | null },
  work: string,
): Promise<BreathingPart | null> {
  if (!meditation.breathing_exercise_id || !meditation.voice_id) return null;

  const { data } = await db()
    .from("omtana_breathing_renders")
    .select("seconds, audio_path, steps, timeline, exercise:omtana_breathing_exercises(name)")
    .eq("exercise_id", meditation.breathing_exercise_id)
    .eq("voice_id", meditation.voice_id)
    .eq("locale", meditation.locale)
    // El hueco se lee de la meditación y no se recalcula: `duration_seconds`
    // mide solo el cuerpo, así que volver a deducir los minutos de ahí da 13
    // donde la sesión pidió 15 — y con eso el render buscado no existe.
    .eq("slot_seconds", meditation.breathing_slot_seconds || breathingSlotSeconds(15))
    .maybeSingle();

  const render = data as
    | {
        seconds: number;
        audio_path: string;
        steps: BreathingStep[];
        timeline: BreathingCue[];
        exercise: { name: string } | null;
      }
    | null;

  if (!render) return null;

  const audio = join(work, "respiracion.mp3");
  await writeFile(audio, await downloadAudio(render.audio_path));

  return {
    name: render.exercise?.name ?? "Respiración",
    seconds: render.seconds,
    audio,
    steps: render.steps ?? [],
    timeline: render.timeline ?? [],
  };
}

/** La música que se hornea. Sin `--musica`, la de la sesión o la primera activa. */
async function pickMusic(
  meditation: Meditation & { music: MusicTrack | null },
  requested: string | null,
  work: string,
): Promise<{ name: string; file: string } | null> {
  if (requested === "ninguna") return null;

  let chosen: MusicTrack | null = null;

  if (requested) {
    const { data } = await db()
      .from("omtana_music_tracks")
      .select("*")
      .eq("slug", requested)
      .maybeSingle();
    chosen = data as MusicTrack | null;
    if (!chosen) fatal(`No hay música con slug "${requested}".`);
  } else if (meditation.music) {
    chosen = meditation.music;
  } else {
    const { data } = await db()
      .from("omtana_music_tracks")
      .select("*")
      .eq("active", true)
      .order("slug")
      .limit(1);
    chosen = ((data as MusicTrack[]) ?? [])[0] ?? null;
  }

  if (!chosen) {
    log.warn("Sin música en el banco: el video sale con la voz sola.");
    return null;
  }

  const file = join(work, "musica.mp3");
  await writeFile(file, await downloadAudio(chosen.audio_path));
  return { name: chosen.name, file };
}

interface TimedSegment {
  at: number;
  seconds: number;
  text: string;
  label: string;
}

async function loadSegments(id: string, offset: number): Promise<TimedSegment[]> {
  const { data } = await db()
    .from("omtana_meditation_segments")
    .select("position, label, script_text, start_offset_seconds, seconds")
    .eq("meditation_id", id)
    .order("position");

  return ((data as MeditationSegment[]) ?? []).map((s) => ({
    at: s.start_offset_seconds + offset,
    seconds: s.seconds,
    text: s.script_text,
    label: s.label,
  }));
}

/* ───────────────────────── subtítulos de la respiración ───────────────────────── */

/**
 * La respiración también se subtitula, y con lo que realmente se oye.
 *
 * Los números no: en pantalla son un parpadeo por segundo y lo que hay que
 * leer es la instrucción. La entrada y el cierre son frases largas, así que
 * pasan por el mismo reparto que el guion.
 */
function breathingCues(breathing: BreathingPart, spans: Span[]): SubtitleCue[] {
  const spoken = breathing.timeline.filter((c) => c.kind !== "count");
  const out: SubtitleCue[] = [];

  for (const [i, cue] of spoken.entries()) {
    const next = spoken[i + 1]?.at ?? breathing.seconds;

    if (cue.kind === "lead" || cue.kind === "tail") {
      out.push(
        ...timePhrases(
          { at: cue.at, seconds: Math.max(0, next - cue.at), text: cue.text },
          spans,
          splitPhrases(cue.text),
        ),
      );
      continue;
    }

    out.push({ start: cue.at, end: Math.min(next, cue.at + 4.5), text: cue.text });
  }

  return out;
}

/**
 * Corre los subtítulos al reloj del recorte.
 *
 * Se van las frases que empezaron antes del corte o que no alcanzan a leerse
 * antes del final: el recorte entra un poco antes de la primera frase, así que
 * sin esto la anterior asoma medio segundo y parpadea.
 */
function shift(cues: SubtitleCue[], from: number, seconds: number): SubtitleCue[] {
  return cues
    .map((c) => ({ ...c, start: c.start - from, end: c.end - from }))
    .filter((c) => c.start >= -0.05 && c.start < seconds - 0.8)
    .map((c) => ({ ...c, start: Math.max(0, c.start), end: Math.min(seconds, c.end) }));
}

/* ───────────────────────── encuadre y recorte ───────────────────────── */

/**
 * La presentación y el cierre del video largo, en segundos.
 *
 * Diez segundos alcanzan para decir de qué es la sesión y si abre con
 * respiración, que es lo que alguien necesita para decidir si se queda; más que
 * eso y ya es una espera antes de lo que vino a hacer.
 */
const CARDS = { intro: 11, outro: 10 };

/**
 * Cuánto dura una pieza de redes. El objetivo manda; los extremos solo
 * descartan lo que no sirve.
 */
const CLIP = { target: 30, min: 16, max: 45 };

/**
 * Qué lleva cada formato.
 *
 * El 16:9 lleva la sesión entera — respiración y meditación, que es para lo
 * que sirve tener quince minutos. Una pieza de redes lleva **una sola cosa**:
 * o el ejercicio de respiración o un pasaje de la meditación. Las dos juntas
 * en un minuto no alcanzan a ser ninguna de las dos: la respiración queda a
 * medio ciclo y la meditación entra por la mitad de una frase.
 *
 * Y se corta donde el material tiene junta, no en el segundo redondo: la
 * respiración en el comienzo de un ciclo, la meditación en el borde de una
 * frase. Un corte a los sesenta segundos exactos siempre cae en mal lugar.
 */
function pickClip(input: {
  format: FormatId;
  total: number;
  breathing: BreathingPart | null;
  cues: SubtitleCue[];
  sample: number | null;
  asked: Asked;
}): Clip | null {
  if (input.sample !== null) {
    return { from: 0, length: Math.min(input.sample, input.total), piece: "completa" };
  }
  if (FORMATS[input.format].maxSeconds === null) return null;

  const bodyFrom = input.breathing?.seconds ?? 0;
  const wantsBreathing =
    input.asked === "respiracion" || (input.asked === "auto" && input.breathing !== null);

  if (wantsBreathing) {
    if (!input.breathing) fatal("Esta sesión no tiene respiración grabada: usa --pieza meditacion.");
    const clip = breathingClip(input.breathing);
    if (clip) return clip;
    log.warn("No cabe un ciclo entero en el máximo: la pieza sale de la meditación.");
  }

  return (
    meditationClip(input.cues, bodyFrom, input.total) ?? {
      // Sin subtítulos con los que alinear — pasa si el guion vino vacío —,
      // se entra pasado el primer tramo y se corta por reloj.
      from: Math.min(bodyFrom + 60, Math.max(bodyFrom, input.total - CLIP.target)),
      length: Math.min(CLIP.target, input.total - bodyFrom),
      piece: "meditacion" as const,
    }
  );
}

/**
 * Ciclos enteros, sin la entrada ni el cierre.
 *
 * Arranca en el primer "inhala" — la entrada explica el patrón y en una pieza
 * de veinte segundos es puro preámbulo — y termina justo donde empezaría el
 * ciclo siguiente, que incluye el respiro del anterior. Así la pieza se puede
 * repetir en bucle sin que se note la juntura.
 */
function breathingClip(breathing: BreathingPart): Clip | null {
  const starts = cycleStarts(breathing.steps);
  if (starts.length < 2) return null;

  const from = starts[0];
  let best: number | null = null;

  for (const end of starts.slice(1)) {
    const length = end - from;
    if (length < CLIP.min || length > CLIP.max) continue;
    if (best === null || Math.abs(length - CLIP.target) < Math.abs(best - CLIP.target)) {
      best = length;
    }
  }

  return best === null ? null : { from, length: best, piece: "respiracion" };
}

/** El segundo en que empieza cada ciclo: el primer paso que lo estrena. */
function cycleStarts(steps: BreathingStep[]): number[] {
  const first = new Map<number, number>();
  for (const step of steps) {
    if (step.kind === "lead" || step.kind === "tail" || step.cycle < 1) continue;
    const at = first.get(step.cycle);
    if (at === undefined || step.at < at) first.set(step.cycle, step.at);
  }
  return [...first.entries()].sort((a, b) => a[0] - b[0]).map(([, at]) => at);
}

/**
 * Un pasaje de la meditación que empieza y termina en frase.
 *
 * Se elige entre las frases ya sincronizadas, así que el recorte no parte
 * ninguna por la mitad. Entre dos pasajes del mismo largo gana el que tiene
 * más texto: treinta segundos de silencio son perfectos dentro de una sesión y
 * son un video vacío en un teléfono.
 */
function meditationClip(cues: SubtitleCue[], bodyFrom: number, total: number): Clip | null {
  const body = cues.filter((c) => c.start >= bodyFrom && c.end <= total - 4);
  if (body.length < 2) return null;

  // Ni el primer tramo, que es el aterrizaje y no se entiende suelto, ni el
  // cierre, que despide de una sesión que esta pieza no tuvo.
  const from = bodyFrom + (total - bodyFrom) * 0.12;
  const to = total - (total - bodyFrom) * 0.12;

  let best: Clip | null = null;
  let bestScore = Infinity;

  for (let i = 0; i < body.length; i++) {
    if (body[i].start < from || body[i].start > to) continue;

    let spoken = 0;
    for (let j = i; j < body.length; j++) {
      const length = body[j].end - body[i].start;
      if (length > CLIP.max) break;
      spoken += body[j].end - body[j].start;
      if (length < CLIP.min) continue;

      // Cuánto se aleja del objetivo, más lo que el pasaje tiene de silencio.
      const score = Math.abs(length - CLIP.target) + (length - spoken) * 0.5;
      if (score >= bestScore) continue;

      bestScore = score;
      best = {
        from: Math.max(bodyFrom, body[i].start - 0.6),
        length: Math.min(length + 1.4, total - body[i].start),
        piece: "meditacion",
      };
    }
  }

  return best;
}

/**
 * El título que se quema en la imagen.
 *
 * En una pieza que **es** el ejercicio, el nombre de la meditación de la que
 * salió promete otra cosa: quien la mira está viendo una respiración de
 * veintitrés segundos, no una sesión sobre reparar una relación.
 */
function titleLine(
  meditation: Meditation,
  breathing: BreathingPart | null,
  piece: Piece,
): string {
  if (piece === "respiracion" && breathing) return `Respiración ${breathing.name}`;
  return meditation.title;
}

/**
 * La línea chica bajo el título.
 *
 * En la pieza larga es la ficha de la sesión. En un recorte, los minutos que
 * dura el recorte no le dicen nada a nadie — lo que importa es qué se está
 * viendo —, así que se nombra la pieza.
 */
function metaLine(
  meditation: Meditation & { voice: Voice | null },
  breathing: BreathingPart | null,
  seconds: number,
  piece: Piece,
): string {
  const voice = meditation.voice?.name ?? "Omtana";

  // El ejercicio ya está en el título de esta pieza; acá solo queda quién lo dice.
  if (piece === "respiracion" && breathing) return voice;
  if (piece === "meditacion") return `${voice} · Meditación guiada`;

  const parts = [voice, `${Math.max(1, Math.round(seconds / 60))} min`];
  if (breathing) parts.push(breathing.name);
  return parts.join(" · ");
}

/**
 * Los capítulos de YouTube, corridos por la presentación.
 *
 * El primero tiene que arrancar en 0:00, y con cartas ese segundo ya no es el
 * de la respiración: es el de la presentación, que además es un capítulo útil
 * — quien vuelve a la sesión quiere saltárselo.
 */
function chapters(breathing: BreathingPart | null, segments: TimedSegment[], intro: number) {
  const rows = segments.map((s) => ({ at: Math.round(s.at) + intro, label: s.label }));
  const body = breathing
    ? [{ at: intro, label: breathing.name }, ...rows]
    : rows;

  return intro > 0 ? [{ at: 0, label: "Presentación" }, ...body] : body;
}

/* ───────────────────────── registro ───────────────────────── */

interface RecordInput {
  file: string;
  srt: string;
  seconds: number;
  width: number;
  height: number;
  theme: ThemeName;
  copy: ReturnType<typeof videoCopy>;
}

/**
 * Deja la pieza en el bucket y anota el export.
 *
 * Un 1080p largo puede pasar el techo de subida del proyecto; en ese caso el
 * archivo local sigue siendo válido — es el que se sube a YouTube — y la fila
 * queda igual, con `video_path` vacío y el aviso en pantalla.
 */
async function record(id: string, format: FormatId, input: RecordInput) {
  let videoPath: string | null = null;
  let subtitlesPath: string | null = null;

  try {
    videoPath = await uploadAudio(`videos/${id}/${format}.mp4`, await readFile(input.file), "video/mp4");
  } catch (err) {
    if (!(err instanceof FileTooLargeError)) throw err;
    log.warn(`No se copió al bucket — ${err.message}`);
  }

  // Los subtítulos son un extra: un bucket viejo puede tener el tipo de archivo
  // restringido a audio y video, y perder el .srt no invalida la pieza — el
  // archivo local es el que se sube a YouTube.
  try {
    subtitlesPath = await uploadAudio(
      `videos/${id}/${format}.srt`,
      await readFile(input.srt),
      "text/plain",
    );
  } catch (err) {
    log.warn(`Subtítulos sin copia en el bucket — ${err instanceof Error ? err.message : err}`);
  }

  const { error } = await db()
    .from("omtana_video_exports")
    .upsert(
      {
        meditation_id: id,
        format,
        status: "ready",
        video_path: videoPath,
        subtitles_path: subtitlesPath,
        seconds: input.seconds,
        width: input.width,
        height: input.height,
        theme: input.theme,
        metadata: input.copy,
        error: null,
      },
      { onConflict: "meditation_id,format" },
    );

  if (error) throw new Error(`No se pudo anotar el export: ${error.message}`);
}

/**
 * Anota lo que no salió.
 *
 * Solo los formatos que no habían quedado listos: si el 16:9 se renderizó y el
 * vertical reventó, marcar los dos como fallidos borraría del registro una
 * pieza que existe.
 */
async function markFailed(id: string, formats: FormatId[], error: string) {
  const { data } = await db()
    .from("omtana_video_exports")
    .select("format, status")
    .eq("meditation_id", id);

  const ready = new Set(
    ((data as { format: string; status: string }[]) ?? [])
      .filter((row) => row.status === "ready")
      .map((row) => row.format),
  );

  const rows = formats
    .filter((format) => !ready.has(format))
    .map((format) => ({
      meditation_id: id,
      format,
      status: "failed",
      error: error.slice(0, 500),
    }));

  if (rows.length === 0) return;
  await db().from("omtana_video_exports").upsert(rows, { onConflict: "meditation_id,format" });
}

/* ───────────────────────── selección ───────────────────────── */

async function pickTargets(args: Args, formats: FormatId[]): Promise<string[]> {
  const ids = args.positional.filter((p) => !p.startsWith("--"));
  if (ids.length > 0) return ids;

  if (args.values.has("semanal")) {
    return balanced(Number(args.values.get("semanal")) || 3, formats);
  }
  if (args.flags.has("semanal")) return balanced(3, formats);
  if (args.flags.has("catalogo")) return pending(formats, 200);

  return [];
}

interface Candidate {
  id: string;
  category: string;
  created_at: string;
  plays: number;
}

/**
 * Las relaciones embebidas llegan como objeto o como arreglo de uno según cómo
 * resuelva PostgREST la clave, y los tipos generados del cliente las dan
 * siempre como arreglo. `one` deja de importar cuál de las dos vino.
 */
type Embedded<T> = T | T[] | null;

function one<T>(value: Embedded<T> | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

interface PublishedRow {
  meditation: Embedded<{ intention: Embedded<{ category: string }> }>;
}

interface CandidateRow {
  id: string;
  created_at: string;
  plays: number;
  intention: Embedded<{ category: string }>;
  video: { format: string; status: string }[] | null;
}

/** Lo público y listo que todavía no tiene video en todos los formatos pedidos. */
async function pending(formats: FormatId[], limit: number): Promise<string[]> {
  return (await candidates(formats)).slice(0, limit).map((c) => c.id);
}

/**
 * La tanda de la semana, repartida entre áreas de la vida.
 *
 * Publicar cinco videos de trabajo seguidos porque son los más nuevos deja el
 * canal escorado igual que deja escorado al banco generar siempre lo mismo. Se
 * toma primero el área con menos videos publicados y se va rotando.
 */
async function balanced(n: number, formats: FormatId[]): Promise<string[]> {
  const rows = await candidates(formats);
  if (rows.length === 0) return [];

  const { data, error } = await db()
    .from("omtana_video_exports")
    .select("meditation:omtana_meditations(intention:omtana_intentions(category))")
    .eq("status", "ready");

  if (error) throw new Error(migrationHint(error.message));

  const published = new Map<string, number>();
  for (const row of (data ?? []) as unknown as PublishedRow[]) {
    const category = one(one(row.meditation)?.intention)?.category ?? "libre";
    published.set(category, (published.get(category) ?? 0) + 1);
  }

  const byCategory = new Map<string, Candidate[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }
  // Dentro de un área, primero lo más escuchado: si hay que elegir uno, que sea
  // el que ya demostró que le sirve a alguien.
  for (const list of byCategory.values()) {
    list.sort((a, b) => b.plays - a.plays || a.created_at.localeCompare(b.created_at));
  }

  const out: string[] = [];
  while (out.length < n) {
    const areas = [...byCategory.entries()].filter(([, list]) => list.length > 0);
    if (areas.length === 0) break;

    areas.sort(
      (a, b) =>
        (published.get(a[0]) ?? 0) - (published.get(b[0]) ?? 0) || a[0].localeCompare(b[0]),
    );

    const [category, list] = areas[0];
    out.push(list.shift()!.id);
    published.set(category, (published.get(category) ?? 0) + 1);
  }

  return out;
}

async function candidates(formats: FormatId[]): Promise<Candidate[]> {
  const { data, error } = await db()
    .from("omtana_meditations")
    .select(
      "id, created_at, plays, intention:omtana_intentions(category), video:omtana_video_exports(format, status)",
    )
    .eq("visibility", "public")
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  if (error) throw new Error(migrationHint(error.message));

  const rows = (data ?? []) as unknown as CandidateRow[];

  return rows
    .filter((row) => {
      const ready = new Set(
        (row.video ?? []).filter((v) => v.status === "ready").map((v) => v.format),
      );
      return formats.some((f) => !ready.has(f));
    })
    .map((row) => ({
      id: row.id,
      category: one(row.intention)?.category ?? "libre",
      created_at: row.created_at,
      plays: row.plays ?? 0,
    }));
}

/**
 * Una base sin la migración 0006 no tiene `format` y el error de PostgREST no
 * dice qué hacer. Lo dice acá: es el primer tropiezo de cualquiera que traiga
 * esto a una base que ya existía.
 */
function migrationHint(message: string): string {
  if (/format|omtana_video_exports/i.test(message)) {
    return `${message}\n    ¿Falta la migración? Corre: npm run db:push -- --solo 0006`;
  }
  return message;
}

/* ───────────────────────── argumentos ───────────────────────── */

function pickFormats(raw: string | undefined): FormatId[] {
  if (!raw || raw === "todos") return FORMAT_IDS;

  const asked = raw.split(",").map((s) => s.trim());
  const unknown = asked.filter((f) => !FORMAT_IDS.includes(f as FormatId));
  if (unknown.length) {
    fatal(`Formato desconocido: ${unknown.join(", ")}. Usa ${FORMAT_IDS.join(", ")} o todos.`);
  }
  return asked as FormatId[];
}

/**
 * Qué se recorta para redes. Sin decir nada, la respiración cuando la sesión
 * la tiene: es la parte que se explica sola, tiene ritmo propio y se ve bien —
 * el disco moviéndose y una instrucción por fase.
 */
function pickPiece(raw: string | undefined): Asked {
  if (!raw) return "auto";
  if (raw !== "respiracion" && raw !== "meditacion" && raw !== "auto") {
    fatal(`Pieza desconocida: ${raw}. Usa respiracion, meditacion o auto.`);
  }
  return raw;
}

function pickTheme(raw: string | undefined): ThemeName {
  if (!raw) return "oscuro";
  if (raw !== "oscuro" && raw !== "claro") fatal(`Tema desconocido: ${raw}. Usa oscuro o claro.`);
  return raw;
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
