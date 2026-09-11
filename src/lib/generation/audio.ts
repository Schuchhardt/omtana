import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

export async function run(bin: string, args: string[]): Promise<string> {
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
      code === 0 ? resolve(out) : reject(new Error(`${bin} salió con ${code}:\n${err.slice(-1500)}`)),
    );
  });
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
      const seconds = Math.max(spoken, seg.targetSeconds);

      // Mono 44.1k para que el concat no tenga que renegociar formatos.
      await run(FFMPEG, [
        "-y", "-i", raw,
        "-af", `apad=whole_dur=${seconds.toFixed(3)}`,
        "-ar", "44100", "-ac", "1",
        fixed,
      ]);

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
