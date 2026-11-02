import { WORDS_PER_MINUTE } from "../session-plan";

/**
 * Guiones que trae la persona en vez de pedírselos al modelo.
 *
 * El texto va tal cual a la voz, con una sola convención: `[pausa 10]` deja
 * diez segundos de silencio en ese punto (también `[pause 10]`, `[silencio
 * 10s]`; sin número son cinco). Es la única acotación que se entiende: el resto
 * de lo que venga entre corchetes se lee en voz alta, así que conviene no
 * ponerlo.
 *
 * Sin dependencias del servidor: lo usan el motor, las rutas y los tests.
 */

/** Lo que se le manda a la voz de una vez. ElevenLabs acepta más, pero un
 * bloque corto que falla se reintenta barato y suena más parejo. */
export const MAX_BLOCK_CHARS = 2400;

/** Tope de un guion completo: unos 17 minutos leídos a 115 palabras por minuto. */
export const MAX_SCRIPT_CHARS = 12_000;

/** Silencio entre párrafos que la persona separó con una línea en blanco. */
export const PARAGRAPH_PAUSE_SECONDS = 2;

export const DEFAULT_PAUSE_SECONDS = 5;
export const MAX_PAUSE_SECONDS = 120;

const PAUSE = /\[\s*(?:pausa|pause|silencio|silence)\s*(\d+(?:[.,]\d+)?)?\s*(?:s|seg|segs|segundos|sec|secs|seconds)?\s*\]/gi;

export interface ScriptBlock {
  text: string;
  /** Silencio después de este bloque, en segundos. */
  pauseAfter: number;
}

function pauseSeconds(raw: string | undefined): number {
  if (!raw) return DEFAULT_PAUSE_SECONDS;
  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value)) return DEFAULT_PAUSE_SECONDS;
  return Math.min(MAX_PAUSE_SECONDS, Math.max(0, value));
}

/** Corta un párrafo largo por oraciones para que ningún bloque pase el tope. */
function splitLong(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];
  const sentences = paragraph.match(/[^.!?…]+[.!?…]+["»”')\]]*\s*|[^.!?…]+$/g) ?? [paragraph];
  const out: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > max) {
      out.push(current.trim());
      current = "";
    }
    // Una oración sola más larga que el tope: se corta por palabras.
    if (sentence.length > max) {
      for (const word of sentence.split(/\s+/)) {
        if (current && current.length + word.length + 1 > max) {
          out.push(current.trim());
          current = "";
        }
        current += `${word} `;
      }
      continue;
    }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Parte el guion en bloques para la voz.
 *
 * Los párrafos se juntan hasta el tope de un bloque (dentro de un bloque, la
 * línea en blanco ya la respeta la voz como pausa); entre bloques que separó
 * un párrafo quedan dos segundos, y donde la persona puso `[pausa N]`, N.
 */
export function splitScript(script: string, maxChars: number = MAX_BLOCK_CHARS): ScriptBlock[] {
  const normalized = script.replace(/\r\n?/g, "\n").trim();
  const chunks: { text: string; pause: number }[] = [];

  let last = 0;
  for (const match of normalized.matchAll(PAUSE)) {
    chunks.push({ text: normalized.slice(last, match.index), pause: pauseSeconds(match[1]) });
    last = (match.index ?? 0) + match[0].length;
  }
  chunks.push({ text: normalized.slice(last), pause: 0 });

  const blocks: ScriptBlock[] = [];
  for (const chunk of chunks) {
    const paragraphs = chunk.text
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean)
      .flatMap((p) => splitLong(p, maxChars));

    if (paragraphs.length === 0) {
      // Dos pausas seguidas, o una al principio: el silencio se suma al bloque anterior.
      if (blocks.length && chunk.pause) blocks[blocks.length - 1].pauseAfter += chunk.pause;
      continue;
    }

    let current: string[] = [];
    let size = 0;
    const flush = (pauseAfter: number) => {
      if (current.length === 0) return;
      blocks.push({ text: current.join("\n\n"), pauseAfter });
      current = [];
      size = 0;
    };
    for (const paragraph of paragraphs) {
      if (size && size + paragraph.length + 2 > maxChars) flush(PARAGRAPH_PAUSE_SECONDS);
      current.push(paragraph);
      size += paragraph.length + 2;
    }
    flush(chunk.pause);
  }

  // La cola del final la pone la mezcla.
  if (blocks.length) blocks[blocks.length - 1].pauseAfter = 0;
  return blocks;
}

/** Lo que dura un guion leído, contando las pausas. Es una estimación. */
export function estimateScriptSeconds(script: string): number {
  const blocks = splitScript(script);
  const words = blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
  const pauses = blocks.reduce((n, b) => n + b.pauseAfter, 0);
  return Math.round((words / WORDS_PER_MINUTE) * 60 + pauses);
}

/** El tramo de una plantilla no admite cortes propios: las pausas se vuelven "...". */
export function scriptAsPlainText(script: string): string {
  return script
    .replace(/\r\n?/g, "\n")
    .replace(PAUSE, " ... ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** La duración del catálogo más cercana a lo que dura el guion. */
export function nearestDuration(seconds: number): 5 | 10 | 15 | 20 {
  const options = [5, 10, 15, 20] as const;
  return options.reduce((best, m) =>
    Math.abs(m * 60 - seconds) < Math.abs(best * 60 - seconds) ? m : best,
  );
}
