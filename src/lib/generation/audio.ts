import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

function exec(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      reject(new Error(`No se pudo ejecutar ${bin}: ${e.message}. ¿Está instalado ffmpeg?`)),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout: out, stderr: err })
        : reject(new Error(`${bin} salió con ${code}:\n${err.slice(-1500)}`)),
    );
  });
}

export async function run(bin: string, args: string[]): Promise<string> {
  return (await exec(bin, args)).stdout;
}

/**
 * Igual que `run` pero devuelve también stderr, que es donde ffmpeg escribe sus
 * análisis (`silencedetect` y compañía). Lo usa la verificación de respiración.
 */
export async function runCapture(bin: string, args: string[]) {
  return exec(bin, args);
}

export { FFMPEG as FFMPEG_BIN, FFPROBE as FFPROBE_BIN };

export class FfmpegMissingError extends Error {}

let ffmpegChecked: boolean | null = null;

/**
 * Comprueba que ffmpeg exista antes de gastar en modelo y en síntesis.
 *
 * En un runtime serverless (Netlify, Lambda) no viene incluido, y sin esto el
 * fallo aparecía recién al mezclar: después de escribir el guion y de grabar la
 * voz, con el costo ya consumido.
 */
export async function ensureFfmpeg(): Promise<void> {
  if (ffmpegChecked === true) return;

  try {
    await run(FFMPEG, ["-version"]);
    ffmpegChecked = true;
  } catch {
    ffmpegChecked = false;
    throw new FfmpegMissingError(
      `No hay ffmpeg en este entorno (${FFMPEG}). La mezcla de audio lo necesita. ` +
        `En servidores sin binarios, genera con "npm run generate" desde una máquina que sí lo tenga, ` +
        `o define FFMPEG_PATH apuntando a uno incluido en el despliegue.`,
    );
  }
}

export async function durationOf(file: string): Promise<number> {
  const out = await run(FFPROBE, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  return Number.parseFloat(out.trim()) || 0;
}

/* ───────────────────────── relleno repartido por las pausas ───────────────────────── */

/**
 * Por debajo de esto la voz se considera callada.
 *
 * Medido contra lo que entrega ElevenLabs: las pausas del guion no son silencio
 * digital, traen room tone alrededor de -30 dB. Con el -40 dB de manual no se
 * detecta ni una sola pausa en voz real.
 */
const SILENCE_FLOOR = "-30dB";
/** Un silencio más corto que esto es respiración, no una pausa del guion. */
const MIN_PAUSE_SECONDS = 0.35;
/**
 * Tope de seguridad al estirar una pausa. Es alto a propósito: en una meditación
 * un silencio largo en medio es parte del guion, mientras que el mismo silencio
 * al final suena a audio cortado. Ante la duda, va adentro.
 */
const MAX_PAUSE_GROWTH_SECONDS = 8;
/** Aire que se deja al final del tramo aunque haya pausas donde repartir. */
const SEGMENT_TAIL_SECONDS = 1.5;
/** Bajo este déficit no vale la pena repartir: la cola sola ya suena natural. */
const DISTRIBUTE_OVER_SECONDS = 2;

const MONO = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/**
 * Las pausas que el guion ya trae, marcadas con "..." y respetadas por la voz.
 *
 * Se descartan la de entrada y la de salida: estirar esas es justo lo que
 * queremos evitar.
 */
async function probePauses(file: string, spoken: number) {
  const { stderr } = await exec(FFMPEG, [
    "-i", file,
    "-af", `silencedetect=noise=${SILENCE_FLOOR}:d=${MIN_PAUSE_SECONDS}`,
    "-f", "null", "-",
  ]);

  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));

  const pauses: number[] = [];
  for (let i = 0; i < starts.length && i < ends.length; i++) {
    const start = starts[i];
    const end = ends[i];
    if (start <= 0.3 || end >= spoken - 0.8) continue;
    pauses.push((start + end) / 2);
  }
  return pauses;
}

/**
 * Lleva un tramo a su duración objetivo repartiendo el silencio por las pausas
 * del guion, en vez de amontonarlo al final.
 *
 * Con todo el relleno junto al final, un tramo de un minuto podía terminar con
 * veinte segundos de nada: se oye como si el audio se hubiera cortado. Repartido
 * por los "..." se oye como lo que es, una meditación que respira.
 */
async function padToTarget(
  source: string,
  destination: string,
  spoken: number,
  target: number,
): Promise<void> {
  const deficit = target - spoken;
  const pauses =
    deficit > DISTRIBUTE_OVER_SECONDS ? await probePauses(source, spoken) : [];

  // Sin pausas donde repartir (tramo corto o voz corrida): la cola es lo que hay.
  if (pauses.length === 0) {
    await run(FFMPEG, [
      "-y", "-i", source,
      "-af", `apad=whole_dur=${target.toFixed(3)}`,
      "-ar", "44100", "-ac", "1",
      destination,
    ]);
    return;
  }

  const growth = Math.min(
    MAX_PAUSE_GROWTH_SECONDS,
    (deficit - SEGMENT_TAIL_SECONDS) / pauses.length,
  );
  const chunks = pauses.length + 1;

  // Se corta la voz en los puntos de pausa, se intercala silencio y se vuelve a
  // pegar. El apad final cierra la cola y garantiza la duración exacta.
  const filter = [
    `[0:a]${MONO},asplit=${chunks}${range(chunks).map((i) => `[s${i}]`).join("")}`,
    ...range(chunks).map((i) => {
      const from = i === 0 ? 0 : pauses[i - 1];
      const to = i === chunks - 1 ? null : pauses[i];
      const trim = `atrim=start=${from.toFixed(3)}${to === null ? "" : `:end=${to.toFixed(3)}`}`;
      return `[s${i}]${trim},asetpts=PTS-STARTPTS[c${i}]`;
    }),
    ...pauses.map((_, i) => `aevalsrc=0:d=${growth.toFixed(3)}:s=44100,${MONO}[g${i}]`),
    range(chunks)
      .map((i) => `[c${i}]${i < pauses.length ? `[g${i}]` : ""}`)
      .join("") +
      `concat=n=${chunks + pauses.length}:v=0:a=1,apad=whole_dur=${target.toFixed(3)}[out]`,
  ].join(";");

  await run(FFMPEG, [
    "-y", "-i", source,
    "-filter_complex", filter,
    "-map", "[out]",
    "-ar", "44100", "-ac", "1",
    destination,
  ]);
}

export interface SegmentInput {
  position: number;
  /** MP3 de voz ya sintetizado o pregenerado. */
  audio: Buffer;
  /** Duración objetivo en segundos; se rellena con silencio hasta llegar. */
  targetSeconds: number;
}

export interface AssembledSegment {
  position: number;
  startOffsetSeconds: number;
  seconds: number;
}

export interface AssemblyResult {
  mp3: Buffer;
  totalSeconds: number;
  segments: AssembledSegment[];
}

/**
 * Junta los tramos de voz en un solo archivo y le pone la música debajo.
 *
 * Cada tramo se estira con silencio hasta su duración objetivo: en una
 * meditación el silencio es parte del guion, así que nunca recortamos la voz
 * para que calce — si la voz dura más que el objetivo, el tramo dura más y el
 * total se recalcula.
 */
export async function assemble(
  segments: SegmentInput[],
  music: Buffer | null,
  opts: { musicVolume?: number; tailSeconds?: number } = {},
): Promise<AssemblyResult> {
  const dir = await mkdtemp(join(tmpdir(), "omtana-"));
  const musicVolume = opts.musicVolume ?? 0.16;
  const tail = opts.tailSeconds ?? 6;

  try {
    const ordered = [...segments].sort((a, b) => a.position - b.position);
    const padded: string[] = [];
    const out: AssembledSegment[] = [];
    let cursor = 0;

    for (const seg of ordered) {
      const raw = join(dir, `raw-${seg.position}.mp3`);
      const fixed = join(dir, `seg-${seg.position}.wav`);
      await writeFile(raw, seg.audio);

      const spoken = await durationOf(raw);

      // Mono 44.1k para que el concat no tenga que renegociar formatos.
      await padToTarget(raw, fixed, spoken, seg.targetSeconds);

      // Se mide el resultado en vez de suponerlo: las pausas repartidas mueven
      // los offsets, y de ahí salen las fases y las palabras del reproductor.
      const seconds = await durationOf(fixed);

      padded.push(fixed);
      out.push({
        position: seg.position,
        startOffsetSeconds: Math.round(cursor),
        seconds: Math.round(seconds),
      });
      cursor += seconds;
    }

    const totalSeconds = Math.round(cursor + tail);
    const finalPath = join(dir, "final.mp3");

    const inputs = padded.flatMap((p) => ["-i", p]);
    const concat = `${padded.map((_, i) => `[${i}:a]`).join("")}concat=n=${padded.length}:v=0:a=1[dry]`;

    if (music) {
      const musicPath = join(dir, "music.mp3");
      await writeFile(musicPath, music);

      const fadeOutStart = Math.max(0, totalSeconds - tail);
      const filter = [
        concat,
        `[dry]apad=whole_dur=${totalSeconds}[voice]`,
        `[${padded.length}:a]aloop=loop=-1:size=2e9,atrim=0:${totalSeconds},` +
          `volume=${musicVolume},afade=t=in:st=0:d=4,afade=t=out:st=${fadeOutStart}:d=${tail}[bed]`,
        `[voice][bed]amix=inputs=2:duration=first:normalize=0[mix]`,
      ].join(";");

      await run(FFMPEG, [
        "-y", ...inputs, "-i", musicPath,
        "-filter_complex", filter,
        "-map", "[mix]",
        "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "1",
        finalPath,
      ]);
    } else {
      await run(FFMPEG, [
        "-y", ...inputs,
        "-filter_complex", `${concat};[dry]apad=whole_dur=${totalSeconds}[mix]`,
        "-map", "[mix]",
        "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "1",
        finalPath,
      ]);
    }

    return { mp3: await readFile(finalPath), totalSeconds, segments: out };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
