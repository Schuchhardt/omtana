/**
 * Sube a YouTube los videos que ya están renderizados.
 *
 *   npm run youtube -- --seco                 dice qué subiría, sin subir nada
 *   npm run youtube -- --cuantos 3
 *   npm run youtube -- --formato vertical --visibilidad unlisted
 *   npm run youtube -- <id-de-meditación>
 *
 * Sube **privado** salvo que se le diga otra cosa. Es deliberado: el canal es
 * la cara pública del proyecto y una pieza generada de punta a punta merece que
 * alguien la mire antes de que la vea nadie más. Pasarlo a público se hace en
 * YouTube, o con `--visibilidad public` si ya lo revisaste.
 *
 * Necesita tres secretos, que salen de una app OAuth de Google Cloud con la
 * YouTube Data API v3 habilitada: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET y
 * YOUTUBE_REFRESH_TOKEN (el que se obtiene una vez, con el scope
 * youtube.upload, desde la cuenta dueña del canal).
 */
import "./_bootstrap";
import { mkdtemp, rm, stat, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { log, requireEnv, parseArgs, fatal } from "./_bootstrap";
import { db } from "../src/lib/supabase";
import { downloadAudio } from "../src/lib/storage";
import { FORMAT_IDS, type FormatId } from "../src/lib/video/brand";
import type { VideoCopy } from "../src/lib/video/copy";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const CAPTIONS_URL =
  "https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet";

/** "People & Blogs". Es donde vive el resto del contenido de este tipo. */
const CATEGORY_ID = "22";

interface ExportRow {
  id: string;
  meditation_id: string;
  format: FormatId;
  video_path: string | null;
  subtitles_path: string | null;
  metadata: VideoCopy;
  meditation: { title: string; locale: string } | { title: string; locale: string }[] | null;
}

async function main() {
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const args = parseArgs();

  const dry = args.flags.has("seco");
  if (!dry) {
    requireEnv("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN");
  }

  const visibility = args.values.get("visibilidad") ?? "private";
  if (!["private", "unlisted", "public"].includes(visibility)) {
    fatal(`Visibilidad desconocida: ${visibility}. Usa private, unlisted o public.`);
  }

  const format = (args.values.get("formato") ?? "youtube") as FormatId;
  if (!FORMAT_IDS.includes(format)) {
    fatal(`Formato desconocido: ${format}. Usa ${FORMAT_IDS.join(", ")}.`);
  }

  const limit = Number(args.values.get("cuantos") ?? 3);
  const ids = args.positional.filter((p) => !p.startsWith("--"));
  const rows = await pending(format, ids, limit);

  if (rows.length === 0) {
    log.done("No hay videos listos y sin subir.");
    return;
  }

  log.title(`${rows.length} video${rows.length === 1 ? "" : "s"} · ${format} · ${visibility}`);

  if (dry) {
    for (const row of rows) log.step(`${title(row)} — ${row.metadata?.title ?? "sin ficha"}`);
    log.done("Corrida en seco: no se subió nada.");
    return;
  }

  const token = await accessToken();
  const work = await mkdtemp(join(tmpdir(), "omtana-youtube-"));
  let ok = 0;

  try {
    for (const [i, row] of rows.entries()) {
      try {
        await publish(row, token, visibility, work, `[${i + 1}/${rows.length}]`);
        ok++;
      } catch (err) {
        log.fail(`${title(row)} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  log.done(`${ok} de ${rows.length} en el canal.`);
  if (ok < rows.length) process.exitCode = 1;
}

function title(row: ExportRow): string {
  const meditation = Array.isArray(row.meditation) ? row.meditation[0] : row.meditation;
  return meditation?.title ?? row.meditation_id;
}

async function pending(format: FormatId, ids: string[], limit: number): Promise<ExportRow[]> {
  let query = db()
    .from("omtana_video_exports")
    .select("id, meditation_id, format, video_path, subtitles_path, metadata, meditation:omtana_meditations(title, locale)")
    .eq("format", format)
    .eq("status", "ready")
    .is("youtube_url", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (ids.length > 0) query = query.in("meditation_id", ids);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ExportRow[];
}

/* ───────────────────────── OAuth ───────────────────────── */

/**
 * El refresh token es el que se guarda; el de acceso dura una hora y se pide
 * en cada corrida. Así el secreto que vive en Actions no caduca solo.
 */
async function accessToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Google no dio token (${res.status}): ${(await res.text()).slice(0, 300)}. ` +
        `Si dice invalid_grant, el refresh token caducó y hay que sacar uno nuevo.`,
    );
  }

  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

/* ───────────────────────── subida ───────────────────────── */

async function publish(
  row: ExportRow,
  token: string,
  visibility: string,
  work: string,
  tag: string,
) {
  if (!row.video_path) {
    throw new Error(
      "el archivo no está en el bucket (pasó el límite de subida). " +
        "Súbelo a mano desde out/video/ o sube el techo en Supabase → Storage.",
    );
  }

  log.step(`${tag} ${title(row)}`);

  const file = join(work, `${row.id}.mp4`);
  await writeFile(file, await downloadAudio(row.video_path));
  const { size } = await stat(file);

  const copy = row.metadata ?? { title: title(row), description: "", tags: [], hashtags: [] };

  // Subida reanudable: se abre la sesión con la ficha y después van los bytes.
  // Es la forma que Google recomienda para archivos grandes, y un 1080p de
  // quince minutos lo es.
  const open = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Length": String(size),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify({
      snippet: {
        title: copy.title,
        description: copy.description,
        tags: copy.tags,
        categoryId: CATEGORY_ID,
        defaultLanguage: locale(row),
        defaultAudioLanguage: locale(row),
      },
      status: {
        privacyStatus: visibility,
        selfDeclaredMadeForKids: false,
        embeddable: true,
      },
    }),
  });

  if (!open.ok) {
    throw new Error(`YouTube rechazó la ficha (${open.status}): ${(await open.text()).slice(0, 300)}`);
  }

  const session = open.headers.get("location");
  if (!session) throw new Error("YouTube no devolvió la URL de subida.");

  const upload = await fetch(session, {
    method: "PUT",
    headers: { "Content-Length": String(size), "Content-Type": "video/mp4" },
    body: await readFile(file),
  });

  if (!upload.ok) {
    throw new Error(`Falló la subida (${upload.status}): ${(await upload.text()).slice(0, 300)}`);
  }

  const video = (await upload.json()) as { id: string };
  const url = `https://youtu.be/${video.id}`;

  await db()
    .from("omtana_video_exports")
    .update({ youtube_url: url, published_at: new Date().toISOString() })
    .eq("id", row.id);

  log.ok(`${title(row)} → ${url} (${visibility})`);

  // Los subtítulos son un extra: si fallan, el video ya está arriba y se
  // pueden cargar a mano desde YouTube Studio.
  if (row.subtitles_path) {
    try {
      await captions(video.id, token, await downloadAudio(row.subtitles_path), locale(row));
      log.info("subtítulos cargados");
    } catch (err) {
      log.warn(`sin subtítulos — ${err instanceof Error ? err.message : err}`);
    }
  }
}

function locale(row: ExportRow): string {
  const meditation = Array.isArray(row.meditation) ? row.meditation[0] : row.meditation;
  return meditation?.locale ?? "es";
}

/** La pista de subtítulos va en multipart: la ficha y el archivo en un cuerpo. */
async function captions(videoId: string, token: string, srt: Buffer, language: string) {
  const boundary = `omtana-${Date.now()}`;
  const meta = JSON.stringify({
    snippet: { videoId, language, name: "Omtana", isDraft: false },
  });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    srt,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetch(CAPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: new Uint8Array(body),
  });

  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
