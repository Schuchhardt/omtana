import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ───────────────────────── dónde está ffmpeg ───────────────────────── */

/**
 * Nombre simbólico del binario. Quien llama a `run(FFMPEG_BIN, …)` no sabe ni
 * le importa dónde está ffmpeg: `exec` lo resuelve la primera vez y lo recuerda.
 */
export const FFMPEG_BIN = "ffmpeg";

const EXE = process.platform === "win32" ? ".exe" : "";

/** Rutas que alguien registró a mano; ver `registerFfmpegCandidate`. */
const extraCandidates: string[] = [];

/**
 * Suma una ruta a la lista de búsqueda. La usa la función de Netlify, que es la
 * única que sabe dónde quedó `ffmpeg-static` después de empaquetarse.
 */
export function registerFfmpegCandidate(path: string | null | undefined): void {
  if (path && !extraCandidates.includes(path)) extraCandidates.push(path);
}

/**
 * Dónde se busca ffmpeg, en orden:
 *
 * 1. `FFMPEG_PATH`, si alguien lo fijó.
 * 2. El del sistema (`brew install ffmpeg`, `apt install ffmpeg`): es el que se
 *    usa en local y en GitHub Actions, y con el que se afinaron los videos.
 * 3. El estático de `ffmpeg-static`, que viaja en `node_modules`. Es el que usa
 *    producción: las funciones de Netlify (Lambda) no traen ningún binario, y
 *    sin esto cada generación fallaba con "No hay ffmpeg en este entorno".
 *
 * No hace falta ffprobe: la duración se lee con el mismo ffmpeg (`durationOf`),
 * así que hay un solo binario que empaquetar.
 */
export function ffmpegCandidates(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string[] {
  const staticBin = join("node_modules", "ffmpeg-static", `ffmpeg${EXE}`);
  const list = [
    env.FFMPEG_PATH,
    `ffmpeg${EXE}`,
    ...extraCandidates,
    join(cwd, staticBin),
    // Raíz de la función en Lambda: ahí deja Netlify lo que pide `included_files`.
    env.LAMBDA_TASK_ROOT ? join(env.LAMBDA_TASK_ROOT, staticBin) : undefined,
  ];
  return [...new Set(list.filter((p): p is string => Boolean(p)))];
}

export interface FfmpegProbe {
  path: string;
  /** Primera línea de `ffmpeg -version`. */
  version: string;
}

export interface FfmpegAttempt {
  path: string;
  error: string;
}

/** Ejecuta un binario tal cual, sin resolver nombres. */
function spawnRaw(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new Error(`No se pudo ejecutar ${bin}: ${e.message}`)));
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout: out, stderr: err })
        : reject(new Error(`${bin} salió con ${code}:\n${err.slice(-1500)}`)),
    );
  });
}

/**
 * Prueba cada candidato con `-version` y devuelve el primero que responde.
 * Si ninguno sirve, devuelve también por qué falló cada uno: es lo que va en
 * el aviso, y lo que hace falta para arreglarlo sin adivinar.
 */
export async function probeFfmpeg(
  candidates: string[] = ffmpegCandidates(),
): Promise<{ found: FfmpegProbe | null; tried: FfmpegAttempt[] }> {
  const tried: FfmpegAttempt[] = [];
  for (const path of candidates) {
    try {
      const { stdout } = await spawnRaw(path, ["-hide_banner", "-version"]);
      return { found: { path, version: stdout.split("\n")[0]?.trim() ?? "" }, tried };
    } catch (err) {
      tried.push({ path, error: err instanceof Error ? err.message.split("\n")[0] : String(err) });
    }
  }
  return { found: null, tried };
}

export class FfmpegMissingError extends Error {
  constructor(readonly tried: FfmpegAttempt[]) {
    super(
      `No hay ffmpeg en este entorno. La mezcla de audio lo necesita. Se probó: ` +
        (tried.map((t) => `${t.path} (${t.error})`).join("; ") || "ninguna ruta") +
        `. En producción viene de "ffmpeg-static": revisa que netlify.toml lo incluya ` +
        `en la función (included_files) o define FFMPEG_PATH.`,
    );
    this.name = "FfmpegMissingError";
  }
}

/** Solo se recuerda el éxito: si falta, la próxima vez se vuelve a buscar. */
let resolved: FfmpegProbe | null = null;

/**
 * Comprueba que ffmpeg exista antes de gastar en modelo y en síntesis, y deja
 * resuelta la ruta para todas las llamadas que vienen después.
 *
 * Sin esto el fallo aparecía recién al mezclar: después de escribir el guion y
 * de grabar la voz, con el costo ya consumido.
 */
export async function ensureFfmpeg(): Promise<FfmpegProbe> {
  if (resolved) return resolved;
  const { found, tried } = await probeFfmpeg();
  if (!found) throw new FfmpegMissingError(tried);
  resolved = found;
  return found;
}

/** Olvida la ruta resuelta. Solo para tests. */
export function resetFfmpegCache(): void {
  resolved = null;
}

async function exec(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const path = bin === FFMPEG_BIN ? (await ensureFfmpeg()).path : bin;
  return spawnRaw(path, args);
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

const TIMESTAMP = String.raw`(\d+):(\d{2}):(\d{2}(?:\.\d+)?)`;

function seconds(h: string, m: string, s: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/**
 * Lee la duración de lo que ffmpeg escribe en stderr al abrir un archivo.
 *
 * `Duration:` es el mismo dato que daba `ffprobe -show_entries format=duration`
 * (la duración del contenedor), redondeado al centésimo. Si el contenedor no
 * la declara, se usa el último `time=` del recorrido, que es lo que de verdad
 * se leyó.
 */
export function parseDuration(stderr: string): number {
  const header = stderr.match(new RegExp(`Duration:\\s*${TIMESTAMP}`));
  if (header) return seconds(header[1], header[2], header[3]);

  const progress = [...stderr.matchAll(new RegExp(`time=\\s*${TIMESTAMP}`, "g"))].at(-1);
  if (progress) return seconds(progress[1], progress[2], progress[3]);

  return 0;
}

export async function durationOf(file: string): Promise<number> {
  // `-c copy` a `null` recorre los paquetes sin decodificar: rápido y sale con 0.
  const { stderr } = await exec(FFMPEG_BIN, [
    "-hide_banner", "-nostdin",
    "-i", file,
    "-c", "copy", "-f", "null", "-",
  ]);
  return parseDuration(stderr);
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
  const { stderr } = await exec(FFMPEG_BIN, [
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
    await run(FFMPEG_BIN, [
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

  await run(FFMPEG_BIN, [
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

      await run(FFMPEG_BIN, [
        "-y", ...inputs, "-i", musicPath,
        "-filter_complex", filter,
        "-map", "[mix]",
        "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "1",
        finalPath,
      ]);
    } else {
      await run(FFMPEG_BIN, [
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
