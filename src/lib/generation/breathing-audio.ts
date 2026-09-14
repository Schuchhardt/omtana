/**
 * El armado del audio de respiración y su verificación.
 *
 * Vive acá y no en el script porque es la parte que tiene que ser exacta: el
 * conteo desalineado que teníamos venía de leer los números de corrido, y lo
 * que lo arregla es esta función y la que la mide justo después.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { durationOf, run, runCapture, FFMPEG_BIN } from "./audio";
import type { BreathingPlan } from "../breathing";
import type { BreathingCheck } from "../types";

/** Sobre este desfase la señal ya se oye fuera de tiempo. */
export const DRIFT_TOLERANCE = 0.25;

/**
 * Cuánto puede pasarse una señal de su hueco antes de ser un problema.
 *
 * El final de una palabra es una caída de volumen, no una sílaba: que la cola
 * de "seis" roce el ataque de "siete" es cómo suena contar rápido. Lo que sí
 * importa es una señal que se pasa por otra palabra entera — ahí la siguiente
 * empieza sobre voz que todavía dice algo.
 */
const OVERLAP_TOLERANCE = 0.25;

const MONO = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono";

/**
 * Cuánto ruido se le pide a la fuente para el soplo de aire.
 *
 * El número parece alto porque el filtro de banda se come casi todo: medido
 * sobre la mezcla, una exhalación queda alrededor de -35 dB de media, unos
 * veinticinco por debajo de la voz. Ahí se oye el aire sin competir con ella.
 */
const BREATH_AMPLITUDE = 0.35;

/**
 * Recorta la última palabra de una frase ya sintetizada.
 *
 * Hay palabras que la voz solo pronuncia bien en contexto: "siete" suelta sale
 * "sete", y dentro de "cinco, seis, siete" sale entera. Grabar la frase y
 * quedarse con el final da la palabra bien dicha, con el precio de que la
 * entonación viene de donde venía.
 */
export async function extractLast(source: string, destination: string): Promise<void> {
  const { onsets } = await detectSpeech(source);
  // Un pelo antes del ataque: cortar justo encima se come la consonante.
  const start = Math.max(0, (onsets[onsets.length - 1] ?? 0) - 0.06);

  await run(FFMPEG_BIN, [
    "-y", "-i", source,
    "-af", `atrim=start=${start.toFixed(3)},asetpts=PTS-STARTPTS`,
    "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "1",
    destination,
  ]);
}

/**
 * Pone un soplo de aire debajo de la voz en cada inhalación y exhalación.
 *
 * Dicho está bien, pero oír el aire entrar y salir se sigue con el cuerpo en
 * vez de con la cabeza: la señal dice cuándo empieza y el soplo dice cuánto
 * dura. Es ruido rosa filtrado a la banda de una respiración, con el volumen
 * subiendo o bajando según el sentido, y muy por debajo de la voz — tiene que
 * notarse sin taparla.
 *
 * Se mezcla **después** de medir la capa de voz: un fondo continuo borraría los
 * silencios que usa la verificación para encontrar cada señal.
 */
export async function mixBreathSounds(
  voice: string,
  plan: BreathingPlan,
  destination: string,
): Promise<void> {
  const breaths = plan.steps.filter(
    (step) => (step.kind === "inhale" || step.kind === "exhale") && step.seconds >= 2,
  );

  if (breaths.length === 0) {
    await run(FFMPEG_BIN, ["-y", "-i", voice, "-c", "copy", destination]);
    return;
  }

  const filter: string[] = [];
  const layers: string[] = [`[0:a]`];

  breaths.forEach((step, i) => {
    const d = step.seconds;
    // La inhalación crece hasta el final y la exhalación se apaga: el mismo
    // soplo al revés, que es lo que hace un cuerpo.
    const fade =
      step.kind === "inhale"
        ? `afade=t=in:st=0:d=${(d * 0.75).toFixed(2)},afade=t=out:st=${(d * 0.8).toFixed(2)}:d=${(d * 0.2).toFixed(2)}`
        : `afade=t=in:st=0:d=${(d * 0.15).toFixed(2)},afade=t=out:st=${(d * 0.25).toFixed(2)}:d=${(d * 0.75).toFixed(2)}`;

    filter.push(
      `anoisesrc=color=pink:amplitude=${BREATH_AMPLITUDE}:duration=${d}:sample_rate=44100,` +
        `highpass=f=${step.kind === "inhale" ? 420 : 280},lowpass=f=2200,` +
        `${fade},${MONO},adelay=${Math.round(step.at * 1000)}[b${i}]`,
    );
    layers.push(`[b${i}]`);
  });

  filter.push(
    `${layers.join("")}amix=inputs=${layers.length}:duration=first:normalize=0[out]`,
  );

  await run(FFMPEG_BIN, [
    "-y", "-i", voice,
    "-filter_complex", filter.join(";"),
    "-map", "[out]",
    "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "1",
    destination,
  ]);
}

/**
 * Le quita a una señal el silencio con el que llega y con el que termina.
 *
 * La síntesis entrega cada palabra con aire a los dos lados. El de delante
 * atrasa el ataque: "dos" se empieza a oír después del segundo dos, poco pero
 * siempre para el mismo lado. El de atrás es peor de diagnosticar, porque hace
 * que la señal *parezca* más larga que su hueco y dispara avisos de solapamiento
 * que no existen. Se recortan los extremos y no el medio — la frase de entrada
 * tiene pausas propias que sí son parte de cómo suena.
 */
export async function trimEdges(audio: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "omtana-trim-"));
  try {
    const source = join(dir, "raw.mp3");
    const trimmed = join(dir, "cue.mp3");
    await writeFile(source, audio);
    await run(FFMPEG_BIN, [
      "-y", "-i", source,
      "-af",
      "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02," +
        "areverse," +
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02," +
        "areverse",
      "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "1",
      trimmed,
    ]);
    const { readFile } = await import("node:fs/promises");
    return readFile(trimmed);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Revisa la grilla contra lo que dura cada señal, antes de armar nada.
 *
 * Una señal más larga que su hueco se pisa con la siguiente: con "sostén" de
 * 1,4 s en un conteo de un segundo, el "dos" empieza antes de que termine la
 * palabra. Es la clase de error que se oye y que no se ve en el guion.
 */
export function overlaps(plan: BreathingPlan, cues: Map<string, { seconds: number }>): string[] {
  const problems: string[] = [];

  for (let i = 0; i < plan.cues.length - 1; i++) {
    const cue = plan.cues[i];
    const gap = plan.cues[i + 1].at - cue.at;
    const seconds = cues.get(cue.slug)?.seconds ?? 0;
    if (seconds > gap + OVERLAP_TOLERANCE) {
      problems.push(
        `"${cue.text}" dura ${seconds.toFixed(2)}s y el hueco hasta la siguiente señal es de ${gap}s`,
      );
    }
  }
  return problems;
}

/**
 * Pega cada señal en su segundo sobre una base de silencio.
 *
 * `adelay` ancla cada una a su milisegundo absoluto, así que una palabra más
 * larga de lo previsto se superpone con la siguiente pero **no corre la
 * grilla**: el segundo veinte sigue siendo el segundo veinte. Esa es toda la
 * diferencia con leer el conteo de corrido.
 */
export async function assembleBreathing(
  plan: BreathingPlan,
  cues: Map<string, { audio: Buffer; seconds: number }>,
  destination: string,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "omtana-breath-"));

  try {
    const files = [...cues.keys()];
    const paths = new Map<string, string>();
    for (const slug of files) {
      const file = join(dir, `${slug}.mp3`);
      await writeFile(file, cues.get(slug)!.audio);
      paths.set(slug, file);
    }

    const uses = new Map<string, number>();
    for (const cue of plan.cues) uses.set(cue.slug, (uses.get(cue.slug) ?? 0) + 1);

    // Una entrada por archivo distinto; `asplit` reparte las copias que hagan falta.
    const inputs = files.flatMap((slug) => ["-i", paths.get(slug)!]);
    const filter: string[] = [];

    files.forEach((slug, index) => {
      const copies = uses.get(slug) ?? 0;
      const labels = Array.from({ length: copies }, (_, i) => `[f${index}_${i}]`).join("");
      filter.push(
        copies > 1
          ? `[${index}:a]${MONO},asplit=${copies}${labels}`
          : `[${index}:a]${MONO}${labels}`,
      );
    });

    const taken = new Map<string, number>();
    const delayed: string[] = [];

    plan.cues.forEach((cue, i) => {
      const index = files.indexOf(cue.slug);
      const copy = taken.get(cue.slug) ?? 0;
      taken.set(cue.slug, copy + 1);
      filter.push(`[f${index}_${copy}]adelay=${Math.round(cue.at * 1000)}[d${i}]`);
      delayed.push(`[d${i}]`);
    });

    filter.push(
      `${delayed.join("")}amix=inputs=${delayed.length}:duration=longest:normalize=0,` +
        `apad=whole_dur=${plan.seconds},atrim=0:${plan.seconds}[out]`,
    );

    await run(FFMPEG_BIN, [
      "-y", ...inputs,
      "-filter_complex", filter.join(";"),
      "-map", "[out]",
      "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "1",
      destination,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface Measurement {
  check: BreathingCheck;
  /** Desfase medido de cada señal: null si falta, "pegada" si no tiene corte delante. */
  drift: Map<number, number | "pegada" | null>;
}

/**
 * Mide el archivo y compara cada señal con el segundo en el que debía sonar.
 *
 * No confía en que ffmpeg haya hecho lo que se le pidió: busca dónde arranca el
 * sonido de verdad (`silencedetect`) y calcula el desfase de cada señal. Es la
 * comprobación que antes no existía, y por eso el conteo se desalineaba sin que
 * nadie se enterara hasta escucharlo.
 */
export async function measure(
  file: string,
  plan: BreathingPlan,
  problems: string[] = [],
): Promise<Measurement> {
  const total = await durationOf(file);
  const { onsets, silences } = await detectSpeech(file);
  const drift = new Map<number, number | "pegada" | null>();
  let maxDrift = 0;
  let matched = 0;
  let glued = 0;

  for (const cue of plan.cues) {
    const near = onsets
      .map((onset) => onset - cue.at)
      .filter((d) => Math.abs(d) <= 0.6)
      .sort((a, b) => Math.abs(a) - Math.abs(b))[0];

    if (near !== undefined) {
      drift.set(cue.at, near);
      maxDrift = Math.max(maxDrift, Math.abs(near));
      matched++;
      continue;
    }

    // Sin corte de silencio delante hay dos casos, y son muy distintos: que no
    // suene nada — la señal se perdió — o que venga pegada a la anterior porque
    // a un conteo por segundo dos palabras se tocan. Lo segundo es cómo suena
    // contar, no un error; solo se avisa cuando falta de verdad.
    const silent = silences.some(([from, to]) => cue.at >= from && cue.at <= to);
    if (silent) {
      drift.set(cue.at, null);
      problems.push(`No se detectó sonido en ${clock(cue.at)} ("${cue.text}")`);
      continue;
    }

    drift.set(cue.at, "pegada");
    glued++;
  }

  if (Math.abs(total - plan.seconds) > 0.3) {
    problems.push(
      `El archivo dura ${total.toFixed(2)}s y la grilla pide ${plan.seconds}s`,
    );
  }
  if (maxDrift > DRIFT_TOLERANCE) {
    problems.push(`Hay señales desfasadas hasta ${maxDrift.toFixed(2)}s`);
  }

  return {
    drift,
    check: {
      totalSeconds: Number(total.toFixed(3)),
      expectedSeconds: plan.seconds,
      maxDriftSeconds: Number(maxDrift.toFixed(3)),
      cuesChecked: matched,
      cuesGlued: glued,
      problems,
    },
  };
}

/**
 * Dónde hay voz y dónde silencio.
 *
 * `onsets` son los instantes en que vuelve a sonar después de una pausa;
 * `silences` los tramos callados, que es lo que permite distinguir una señal
 * que falta de una que viene pegada a la anterior.
 */
async function detectSpeech(
  file: string,
): Promise<{ onsets: number[]; silences: [number, number][] }> {
  const { stderr } = await runCapture(FFMPEG_BIN, [
    "-i", file,
    // 0.25 s y no 0.12: dentro de una palabra hay silencios — la "t" de
    // "cuatro" son ciento y pico de milisegundos — y contarlos como pausa
    // inventaba señales donde no las hay. Con el conteo en el último segundo,
    // entre dos señales de verdad hay un segundo o más.
    "-af", "silencedetect=noise=-38dB:d=0.25",
    "-f", "null", "-",
  ]);

  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));

  const silences: [number, number][] = starts.map((from, i) => [
    from,
    ends[i] ?? Number.POSITIVE_INFINITY,
  ]);

  // Si el archivo empieza sonando no hay un `silence_end` para la primera señal.
  const startsLoud = !(starts[0] !== undefined && starts[0] <= 0.05);
  return { onsets: startsLoud ? [0, ...ends] : ends, silences };
}

function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
