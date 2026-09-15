/**
 * Los subtítulos del video.
 *
 * El guion está guardado por tramos: sabemos qué dice cada uno y en qué
 * segundo empieza, pero no en qué segundo cae cada frase. Sincronizarlo
 * repartiendo el texto de forma pareja sobre el tramo no sirve — una meditación
 * es mitad silencio, y a los dos minutos el texto va medio minuto adelantado.
 *
 * Así que se mide el audio: `silencedetect` devuelve dónde hay voz y dónde no,
 * y las frases se reparten sobre el **tiempo hablado**, no sobre el tiempo de
 * reloj. Una frase que cae antes de una pausa larga se queda en pantalla
 * durante la pausa, que es exactamente lo que uno quiere leer mientras respira.
 *
 * No cuesta síntesis ni modelo, y funciona sobre las meditaciones que ya
 * existen — que son todas.
 */
import { runCapture, FFMPEG_BIN } from "../generation/audio";
import { ass, type Format, type Layout, type Theme } from "./brand";

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

/** Un tramo de la sesión, ya ubicado en la línea de tiempo del video. */
export interface SubtitleSegment {
  at: number;
  seconds: number;
  text: string;
}

/** Caracteres por línea antes de cortar, y cuántas líneas se permiten. */
const LINE = 42;
const LINES = 2;
/** Una frase nunca dura menos de esto, aunque sea una palabra. */
const MIN_SECONDS = 1.2;

/**
 * Corta un tramo de guion en frases que quepan en pantalla.
 *
 * Los "..." del guion son pausas escritas a propósito, así que valen como
 * corte; el resto sale por puntuación. Lo que igual no cabe se parte por
 * palabras, nunca a mitad de una.
 */
export function splitPhrases(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const chunks = clean
    .split(/(?<=\.\.\.)|(?<=[.!?…])\s+|(?<=[;:])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= LINE * LINES) {
      out.push(chunk);
      continue;
    }
    // Demasiado largo: se parte por comas y, si aún no cabe, por palabras.
    for (const piece of splitLong(chunk)) out.push(piece);
  }
  return out;
}

function splitLong(chunk: string): string[] {
  const words = chunk.split(" ");
  const out: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > LINE * LINES && current) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Envuelve una frase en hasta dos líneas equilibradas. */
export function wrap(text: string): string[] {
  if (text.length <= LINE) return [text];

  const words = text.split(" ");
  const half = Math.ceil(text.length / 2);
  let best = words.length - 1;
  let bestDiff = Infinity;

  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" ").length;
    const diff = Math.abs(left - half);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }

  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

/* ───────────────────────── dónde hay voz ───────────────────────── */

export interface Span {
  start: number;
  end: number;
}

/**
 * Los tramos con voz de un archivo, según `silencedetect`.
 *
 * El umbral es generoso (-38 dB, 400 ms) porque lo que queremos separar son
 * las pausas escritas del guion, no los respiros entre palabras.
 */
export async function speechSpans(file: string, totalSeconds: number): Promise<Span[]> {
  const { stderr } = await runCapture(FFMPEG_BIN, [
    "-hide_banner", "-nostats",
    "-i", file,
    "-af", "silencedetect=noise=-38dB:d=0.4",
    "-f", "null", "-",
  ]);

  const silences: Span[] = [];
  let open: number | null = null;

  for (const line of stderr.split("\n")) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) {
      open = Math.max(0, Number.parseFloat(start[1]));
      continue;
    }
    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (end && open !== null) {
      silences.push({ start: open, end: Number.parseFloat(end[1]) });
      open = null;
    }
  }
  if (open !== null) silences.push({ start: open, end: totalSeconds });

  // El complemento de los silencios es la voz.
  const spans: Span[] = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start > cursor) spans.push({ start: cursor, end: Math.min(s.start, totalSeconds) });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < totalSeconds) spans.push({ start: cursor, end: totalSeconds });

  return spans.filter((s) => s.end - s.start > 0.25);
}

/**
 * Reparte las frases de un tramo sobre el tiempo hablado que hay dentro de él.
 *
 * `spans` son los tramos con voz de la sesión entera; acá se recortan al tramo
 * y se convierten en un reloj propio: "el segundo 12 de habla" se traduce al
 * segundo de reloj donde realmente cae, saltándose los silencios.
 */
export function timePhrases(
  segment: SubtitleSegment,
  spans: Span[],
  phrases: string[],
): SubtitleCue[] {
  if (phrases.length === 0) return [];

  const from = segment.at;
  const to = segment.at + segment.seconds;
  const local = spans
    .map((s) => ({ start: Math.max(s.start, from), end: Math.min(s.end, to) }))
    .filter((s) => s.end - s.start > 0.25);

  const spoken = local.reduce((n, s) => n + (s.end - s.start), 0);

  // Sin voz detectada (o casi): reparto parejo sobre el tramo. Pasa en tramos
  // muy cortos y en audios con música mezclada dentro.
  if (spoken < 1) {
    const each = segment.seconds / phrases.length;
    return phrases.map((text, i) => ({
      start: from + each * i,
      end: from + each * (i + 1),
      text,
    }));
  }

  const clock = (spokenSeconds: number): number => {
    let left = spokenSeconds;
    for (const span of local) {
      const length = span.end - span.start;
      if (left <= length) return span.start + left;
      left -= length;
    }
    return local[local.length - 1].end;
  };

  const chars = phrases.reduce((n, p) => n + p.length, 0);
  const cues: SubtitleCue[] = [];
  let cursor = 0;

  for (const text of phrases) {
    const share = (text.length / chars) * spoken;
    const start = clock(cursor);
    cursor += share;
    const end = Math.max(clock(cursor), start + MIN_SECONDS);
    cues.push({ start, end, text });
  }

  // La última frase se queda hasta el final del tramo: cortarla en seco justo
  // cuando la voz para deja un hueco raro antes del tramo siguiente.
  cues[cues.length - 1].end = Math.max(cues[cues.length - 1].end, to - 0.4);
  return cues;
}

/** Que ninguna frase pise a la siguiente ni se salga del video. */
export function tidy(cues: SubtitleCue[], totalSeconds: number): SubtitleCue[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  return sorted
    .map((cue, i) => {
      const next = sorted[i + 1];
      const end = next ? Math.min(cue.end, next.start - 0.08) : Math.min(cue.end, totalSeconds);
      return { ...cue, end };
    })
    .filter((cue) => cue.end - cue.start > 0.3 && cue.start < totalSeconds);
}

/* ───────────────────────── archivos ───────────────────────── */

/**
 * El archivo ASS que quema ffmpeg sobre el video.
 *
 * ASS y no SRT porque acá el subtítulo es diseño: tipografía de la marca,
 * interlineado, margen y un fundido de medio segundo en cada frase. Un SRT
 * quemado sale con la fuente por defecto y bordes negros.
 */
export function toAss(
  cues: SubtitleCue[],
  { format, layout, theme, font }: { format: Format; layout: Layout; theme: Theme; font: string },
): string {
  const marginV = format.height - layout.subtitleY;
  const fontName = fontFamily(font);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${format.width}`,
    `PlayResY: ${format.height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour," +
      " Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline," +
      " Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Omtana,${fontName},${layout.subtitleSize},${ass(theme.text)},${ass(theme.text)},` +
      `${ass(theme.background)},${ass(theme.background, 0x80)},0,0,0,0,100,100,2,0,1,0,0,2,` +
      `${layout.subtitleMargin},${layout.subtitleMargin},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events = cues.map((cue) => {
    const text = wrap(cue.text)
      .map((line) => line.replace(/\{/g, "(").replace(/\}/g, ")"))
      .join("\\N");
    // El fundido entra rápido y sale lento: aparecer de golpe distrae, quedarse
    // un segundo de más acompaña.
    return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Omtana,,0,0,0,,{\\fad(400,700)}${text}`;
  });

  return `${header}\n${events.join("\n")}\n`;
}

/** El SRT que se sube junto al video: YouTube lo quiere aparte, no quemado. */
export function toSrt(cues: SubtitleCue[]): string {
  return cues
    .map((cue, i) =>
      [
        String(i + 1),
        `${srtTime(cue.start)} --> ${srtTime(cue.end)}`,
        wrap(cue.text).join("\n"),
        "",
      ].join("\n"),
    )
    .join("\n");
}

function assTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

function srtTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/**
 * libass busca la tipografía por familia, no por archivo: el directorio se le
 * pasa aparte (`fontsdir`) y acá va el nombre que el .ttf declara adentro.
 * Jost se llama "Jost*" — con asterisco — y la Light es su propia familia.
 */
function fontFamily(fontFile: string): string {
  return /Light/.test(fontFile) ? "Jost* Light" : "Jost*";
}
