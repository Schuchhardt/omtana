/**
 * Convierte una meditación en el video que se sube a YouTube: fondo oscuro,
 * onda de audio reactiva, palabras clave y el wordmark. 1920×1080.
 *
 *   npm run video -- <id-de-meditación>
 *   npm run video -- --catalogo           todas las públicas sin video
 *   npm run video -- <id> --salida out/
 *
 * El pipeline de video es distribución, no un extra: existe desde el día uno.
 */
import "./_bootstrap";
import { mkdir, writeFile, rm, readFile, access } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { log, requireEnv, parseArgs, fatal } from "./_bootstrap";
import { db } from "../src/lib/supabase";
import { downloadAudio, uploadAudio, FileTooLargeError } from "../src/lib/storage";
import { run, durationOf } from "../src/lib/generation/audio";
import type { Cue, Meditation, Voice } from "../src/lib/types";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const W = 1920;
const H = 1080;
const BG = "0x1B1713";
const WAVE_COLOR = "0xC4A98F";
const FONT_DIR = "assets/fonts";
const FONT_FILE = join(FONT_DIR, "Jost-Light.ttf");
const FONT_URL =
  "https://github.com/indestructible-type/Jost/raw/master/fonts/ttf/Jost-300-Light.ttf";

async function main() {
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const args = parseArgs();
  const outDir = resolve(args.values.get("salida") ?? "out/video");
  await mkdir(outDir, { recursive: true });

  const font = await ensureFont();
  const logo = await ensureLogo();

  const targets = args.flags.has("catalogo")
    ? await catalogTargets()
    : args.positional.filter((p) => !p.startsWith("--"));

  if (targets.length === 0) {
    fatal(
      "Falta el id de la meditación.\n" +
        "    npm run video -- <id>\n" +
        "    npm run video -- --catalogo",
    );
  }

  log.title(`Exportando ${targets.length} video${targets.length === 1 ? "" : "s"}`);

  for (const [i, id] of targets.entries()) {
    try {
      await exportOne(id, outDir, font, logo, `[${i + 1}/${targets.length}]`);
    } catch (err) {
      log.fail(`${id} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log.done(`Videos en ${outDir}`);
}

async function catalogTargets(): Promise<string[]> {
  const { data } = await db()
    .from("omtana_meditations")
    .select("id, video:omtana_video_exports(id, status)")
    .eq("visibility", "public")
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  return ((data ?? []) as { id: string; video: { status: string }[] }[])
    .filter((m) => !m.video?.some((v) => v.status === "ready"))
    .map((m) => m.id);
}

async function exportOne(
  id: string,
  outDir: string,
  font: string | null,
  logo: string | null,
  tag: string,
) {
  const { data } = await db()
    .from("omtana_meditations")
    .select("*, voice:omtana_voices(name)")
    .eq("id", id)
    .maybeSingle();

  const meditation = data as (Meditation & { voice: Voice | null }) | null;
  if (!meditation) throw new Error("no existe");
  if (meditation.status !== "ready" || !meditation.audio_path) {
    throw new Error("todavía no está lista");
  }

  log.step(`${tag} ${meditation.title}`);

  const { data: cueRows } = await db()
    .from("omtana_meditation_cues")
    .select("at_seconds, word")
    .eq("meditation_id", id)
    .order("at_seconds");
  const cues = (cueRows as Cue[]) ?? [];

  const { data: exportRow } = await db()
    .from("omtana_video_exports")
    .insert({ meditation_id: id, status: "rendering" })
    .select("id")
    .single();

  const work = await mkdtemp(join(tmpdir(), "omtana-video-"));

  try {
    const audioPath = join(work, "audio.mp3");
    await writeFile(audioPath, await downloadAudio(meditation.audio_path));
    const seconds = Math.ceil(await durationOf(audioPath));

    const inputs = ["-i", audioPath];
    if (logo) inputs.push("-loop", "1", "-i", logo);

    const filters: string[] = [
      `color=c=${BG}:s=${W}x${H}:r=30:d=${seconds}[bg]`,
      // Un poco de calor detrás de la onda, como el disco que respira en la app.
      `[bg]drawbox=x=0:y=0:w=${W}:h=${H}:color=${BG}:t=fill[base]`,
      `[0:a]showwaves=s=1280x260:mode=cline:colors=${WAVE_COLOR}:rate=30:draw=full[wave]`,
      `[base][wave]overlay=x=(W-w)/2:y=(H-h)/2-40[stage]`,
    ];

    let last = "stage";

    if (logo) {
      const logoIndex = 1;
      filters.push(
        `[${logoIndex}:v]format=rgba,colorchannelmixer=aa=0.5[logo]`,
        `[${last}][logo]overlay=x=96:y=88:shortest=1[branded]`,
      );
      last = "branded";
    }

    if (font) {
      // Palabras clave: aparecen con fundido y se van a los ocho segundos.
      cues.forEach((cue, i) => {
        const start = cue.at_seconds;
        const end = Math.min(seconds, start + 8);
        const next = `kw${i}`;
        filters.push(
          `[${last}]drawtext=fontfile='${font}':text='${escapeText(cue.word)}':` +
            `fontcolor=0xC4B9AA:fontsize=54:x=(w-text_w)/2:y=h/2+180:` +
            `alpha='if(lt(t,${start}),0,if(lt(t,${start + 1}),(t-${start}),if(lt(t,${end - 1}),1,if(lt(t,${end}),${end}-t,0))))':` +
            `enable='between(t,${start},${end})'[${next}]`,
        );
        last = next;
      });

      filters.push(
        `[${last}]drawtext=fontfile='${font}':text='${escapeText(meditation.title)}':` +
          `fontcolor=0xF6F1E9:fontsize=46:x=(w-text_w)/2:y=h-190[title]`,
        `[title]drawtext=fontfile='${font}':text='${escapeText(
          `${meditation.voice?.name ?? "Omtana"} · ${Math.round(seconds / 60)} min`,
        )}':fontcolor=0x8B8074:fontsize=30:x=(w-text_w)/2:y=h-126[out]`,
      );
      last = "out";
    }

    const outPath = join(outDir, `${slug(meditation.title)}-${id.slice(0, 8)}.mp4`);

    await run(FFMPEG, [
      "-y", ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", `[${last}]`, "-map", "0:a",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20",
      "-pix_fmt", "yuv420p", "-r", "30",
      "-c:a", "aac", "-b:a", "192k",
      "-shortest", "-movflags", "+faststart",
      outPath,
    ]);

    // También queda en storage, para no depender de la máquina que lo renderizó.
    // Un 1080p largo puede pasar el techo de subida del proyecto; en ese caso el
    // archivo local sigue siendo válido — es el que se sube a YouTube.
    let storedPath: string | null = null;
    try {
      storedPath = await uploadAudio(`videos/${id}.mp4`, await readFile(outPath), "video/mp4");
    } catch (err) {
      if (!(err instanceof FileTooLargeError)) throw err;
      log.warn(`${meditation.title}: no se copió al bucket — ${err.message}`);
    }

    await db()
      .from("omtana_video_exports")
      .update({ status: "ready", video_path: storedPath })
      .eq("id", exportRow!.id);

    log.ok(`${meditation.title} → ${outPath}`);
  } catch (err) {
    await db()
      .from("omtana_video_exports")
      .update({ status: "failed", error: err instanceof Error ? err.message : String(err) })
      .eq("id", exportRow!.id);
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/* ───────────────────────── recursos ───────────────────────── */

async function ensureFont(): Promise<string | null> {
  try {
    await access(FONT_FILE);
    return resolve(FONT_FILE);
  } catch {
    /* se descarga abajo */
  }

  try {
    log.info("Bajando Jost Light para los rótulos…");
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(String(res.status));
    await mkdir(FONT_DIR, { recursive: true });
    await writeFile(FONT_FILE, Buffer.from(await res.arrayBuffer()));
    return resolve(FONT_FILE);
  } catch {
    log.warn(`No se pudo obtener la tipografía; el video sale sin texto.`);
    log.info(`Deja un .ttf en ${FONT_FILE} y vuelve a correr.`);
    return null;
  }
}

/** ffmpeg no lee SVG, así que rasterizamos el wordmark una vez. */
async function ensureLogo(): Promise<string | null> {
  const png = "public/brand/omtana-wordmark-white.png";
  try {
    await access(png);
    return resolve(png);
  } catch {
    /* se genera abajo */
  }

  try {
    const sharp = (await import("sharp")).default;
    const svg = await readFile("public/brand/omtana-wordmark-white.svg");
    await sharp(svg, { density: 600 }).resize({ width: 300 }).png().toFile(png);
    return resolve(png);
  } catch (err) {
    log.warn(`Sin wordmark en el video: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** drawtext trata ' : \ y % como sintaxis. */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "’")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
