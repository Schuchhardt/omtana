/**
 * Publica en redes, por la API de Zernio, los videos que ya están renderizados.
 *
 *   npm run zernio -- --cuentas                       qué cuentas hay conectadas
 *   npm run zernio -- --seco [--cuantos 3]            qué publicaría, sin tocar nada
 *   npm run zernio -- --cuantos 3                     programa los próximos tres exports
 *   npm run zernio -- <id-de-meditación>              programa los exports de esa meditación
 *   npm run zernio -- --sincronizar                   trae estados y URLs de lo programado
 *   npm run zernio -- --cancelar <id-de-publicación>  frena un post que todavía no salió
 *
 * Opciones de publicación:
 *   --formato vertical|youtube|cuadrado   solo ese formato (por defecto, los tres)
 *   --plataformas youtube,instagram       o PUBLISH_PLATFORMS (por defecto youtube,instagram)
 *   --en 48                               horas desde ahora (por defecto 48)
 *   --programar 2026-10-01T10:00          hora local en PUBLISH_TIMEZONE (America/Santiago)
 *   --ahora                               publica en el momento, sin ventana
 *   --visibilidad public|private|unlisted YouTube (por defecto public)
 *   --desde out/video                     dónde buscar los archivos locales
 *
 * Sube **público a YouTube, pero programado 48 horas después**. Esa es la
 * ventana de revisión: el post queda en Zernio con hora, `--seco` y
 * `--sincronizar` muestran qué va a salir, y si algo no convence se frena con
 * `--cancelar <id-de-publicación>` (el id está en `omtana_publications` y lo
 * imprime este mismo comando al programar). Cancelar un post lo cancela en
 * todas las redes a las que iba, porque para Zernio es una sola pieza.
 *
 * Se elige público y no privado porque Zernio no puede pasar un video de
 * YouTube de privado a público después: habría que hacerlo a mano en YouTube
 * Studio, y la ventana de 48 horas cumple el mismo papel sin ese paso.
 *
 * El archivo se toma de `--desde` si está (`<slug>-<id8>-<formato>.mp4`, como
 * lo deja `npm run video`) y, si no, del bucket. Por eso un export sin
 * `video_path` — el 16:9 largo que pasó el techo del bucket — se publica igual
 * desde la máquina que lo renderizó.
 *
 * Necesita SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y ZERNIO_API_KEY (salvo
 * `--seco`, que sin la key igual lista qué publicaría).
 */
import "./_bootstrap";
import { access, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { log, requireEnv, parseArgs, fatal, type Args } from "./_bootstrap";
import { db } from "../src/lib/supabase";
import { downloadAudio } from "../src/lib/storage";
import { FORMAT_IDS, slug, type FormatId } from "../src/lib/video/brand";
import type { VideoCopy } from "../src/lib/video/copy";
import {
  cancelPost,
  createPost,
  getPost,
  listAccounts,
  MEDIA_TTL_MS,
  presign,
  putMedia,
  type PlatformStatus,
  type PostStatus,
  type YouTubeVisibility,
  type ZernioAccount,
} from "../src/lib/distribution/zernio";
import {
  buildPost,
  fitsPlatform,
  isPlatform,
  PLATFORMS,
  platformsFor,
  requestIdFor,
  type Platform,
} from "../src/lib/distribution/plan";

const DEFAULT_PLATFORMS = "youtube,instagram";
const DEFAULT_TIMEZONE = "America/Santiago";
const DEFAULT_DELAY_HOURS = 48;
const DEFAULT_DIR = "out/video";
const CONTENT_TYPE = "video/mp4";

/** Estados de una publicación que todavía pueden cambiar. */
const OPEN_STATUSES = ["queued", "scheduled", "publishing"];

interface ExportRow {
  id: string;
  meditation_id: string;
  format: FormatId;
  seconds: number;
  video_path: string | null;
  youtube_url: string | null;
  metadata: Partial<VideoCopy> | null;
  meditation: { title: string; locale: string } | { title: string; locale: string }[] | null;
}

interface PublicationRow {
  id: string;
  export_id: string;
  meditation_id: string;
  platform: Platform;
  account_id: string;
  provider_post_id: string | null;
  status: string;
}

interface Plan {
  row: ExportRow;
  platforms: Platform[];
  /** De dónde sale el archivo: ruta local, o `null` si hay que bajarlo. */
  localFile: string | null;
  longVideoUrl?: string;
}

interface Schedule {
  publishNow: boolean;
  /** UTC, ISO. */
  scheduledFor?: string;
  timezone: string;
}

async function main() {
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const args = parseArgs();

  if (args.flags.has("cuentas")) return accounts();
  if (args.flags.has("sincronizar")) return sync();
  if (args.values.has("cancelar")) return cancel(args.values.get("cancelar")!);
  if (args.flags.has("cancelar")) fatal("--cancelar necesita el id de la publicación.");
  return publish(args);
}

/* ───────────────────────── cuentas ───────────────────────── */

async function accounts() {
  requireEnv("ZERNIO_API_KEY");
  const list = await listAccounts();

  if (list.length === 0) {
    log.done("No hay cuentas conectadas en Zernio.");
    return;
  }

  log.title(`${list.length} cuenta${list.length === 1 ? "" : "s"} en Zernio`);
  for (const a of list) {
    const state = a.isActive ? "activa" : "inactiva";
    const warn = a.needsReconnection ? " · hay que reconectarla" : "";
    log.step(`${a._id}  ${a.platform.padEnd(10)} ${a.username ?? a.displayName ?? "—"}  (${state}${warn})`);
  }
  log.done("Las que se usan son las activas de las redes pedidas en --plataformas.");
}

/* ───────────────────────── publicar ───────────────────────── */

async function publish(args: Args) {
  const dry = args.flags.has("seco");
  if (!dry) requireEnv("ZERNIO_API_KEY");

  const visibility = (args.values.get("visibilidad") ?? "public") as YouTubeVisibility;
  if (!["public", "private", "unlisted"].includes(visibility)) {
    fatal(`Visibilidad desconocida: ${visibility}. Usa public, private o unlisted.`);
  }

  const format = args.values.get("formato") as FormatId | undefined;
  if (format && !FORMAT_IDS.includes(format)) {
    fatal(`Formato desconocido: ${format}. Usa ${FORMAT_IDS.join(", ")}.`);
  }

  const requested = pickPlatforms(args.values.get("plataformas") ?? process.env.PUBLISH_PLATFORMS ?? DEFAULT_PLATFORMS);
  const schedule = pickSchedule(args);
  const dir = resolve(args.values.get("desde") ?? DEFAULT_DIR);

  const ids = args.positional.filter((p) => !p.startsWith("--"));
  const limit = args.values.has("cuantos") ? Number(args.values.get("cuantos")) : ids.length > 0 ? Infinity : 3;
  if (!Number.isFinite(limit) && ids.length === 0) fatal("--cuantos espera un número: --cuantos 3");

  // Sin la key se puede planear igual: se asume una cuenta activa por red.
  let accounts: ZernioAccount[] | null = null;
  if (process.env.ZERNIO_API_KEY) {
    accounts = await listAccounts();
  } else {
    log.warn("Sin ZERNIO_API_KEY no se pueden consultar las cuentas conectadas; se asume una activa por red.");
  }

  const plans = await planAll({ format, ids, requested, accounts, dir, limit, dry });

  if (plans.length === 0) {
    log.done("No hay exports listos y sin publicar para esas redes.");
    return;
  }

  const when = schedule.publishNow
    ? "ahora"
    : `${local(schedule.scheduledFor!, schedule.timezone)} (${schedule.timezone})`;
  log.title(`${plans.length} export${plans.length === 1 ? "" : "s"} · ${when} · YouTube ${visibility}`);

  for (const plan of plans) {
    const src = plan.localFile ? "archivo local" : "bucket";
    log.step(`${title(plan.row)} · ${plan.row.format} · ${plan.row.seconds}s → ${plan.platforms.join(", ")} (${src})`);
    if (plan.longVideoUrl) log.info(`enlaza al video largo: ${plan.longVideoUrl}`);
  }

  if (dry) {
    log.done("Corrida en seco: no se publicó nada.");
    return;
  }

  const work = await mkdtemp(join(tmpdir(), "omtana-zernio-"));
  let ok = 0;

  try {
    for (const [i, plan] of plans.entries()) {
      try {
        await publishOne(plan, accounts ?? [], schedule, visibility, work, `[${i + 1}/${plans.length}]`);
        ok++;
      } catch (err) {
        log.fail(`${title(plan.row)} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  log.done(
    `${ok} de ${plans.length} en Zernio. ` +
      (schedule.publishNow
        ? "Corre --sincronizar para traer las URLs."
        : "Para frenar uno antes de que salga: npm run zernio -- --cancelar <id-de-publicación>."),
  );
  if (ok < plans.length) process.exitCode = 1;
}

interface PlanInput {
  format?: FormatId;
  ids: string[];
  requested: Platform[];
  accounts: ZernioAccount[] | null;
  dir: string;
  limit: number;
  dry: boolean;
}

/**
 * Decide qué exports van y a qué redes. Se leen todos los `ready` y se filtra
 * en memoria: el catálogo es chico y las razones para saltar uno (ya
 * publicado, sin cuenta, no cabe, sin archivo) se explican mejor una por una.
 */
async function planAll(input: PlanInput): Promise<Plan[]> {
  const rows = await readyExports(input.format, input.ids);
  if (rows.length === 0) return [];

  const done = await publishedKeys(rows.map((r) => r.id), input.dry);
  const longUrls = await longVideoUrls(rows.map((r) => r.meditation_id));

  const active = new Set(
    (input.accounts ?? []).filter((a) => a.isActive).map((a) => a.platform),
  );

  const plans: Plan[] = [];

  for (const row of rows) {
    if (plans.length >= input.limit) break;

    const platforms: Platform[] = [];
    for (const platform of input.requested) {
      if (!platformsFor(row.format).includes(platform)) continue;

      if (done.has(`${row.id}:${platform}`)) {
        log.info(`${title(row)} · ${row.format}: ya hay una publicación en ${platform}`);
        continue;
      }

      const reason = fitsPlatform(platform, row.format, row.seconds);
      if (reason) {
        log.warn(`${title(row)} · ${row.format}: se omite ${platform} — ${reason}`);
        continue;
      }

      if (input.accounts && !active.has(platform)) {
        log.warn(`${title(row)} · ${row.format}: se omite ${platform} — no hay cuenta activa conectada`);
        continue;
      }

      platforms.push(platform);
    }

    if (platforms.length === 0) continue;

    const localFile = await findLocal(row, input.dir);
    if (!localFile && !row.video_path) {
      log.warn(`${title(row)} · ${row.format}: sin archivo ni en ${input.dir} ni en el bucket; se salta`);
      continue;
    }

    plans.push({
      row,
      platforms,
      localFile,
      // Los recortes enlazan al largo solo si ya está en YouTube.
      longVideoUrl: row.format === "youtube" ? undefined : longUrls.get(row.meditation_id),
    });
  }

  return plans;
}

async function publishOne(
  plan: Plan,
  accounts: ZernioAccount[],
  schedule: Schedule,
  visibility: YouTubeVisibility,
  work: string,
  tag: string,
) {
  const { row, platforms } = plan;
  log.step(`${tag} ${title(row)} · ${row.format} → ${platforms.join(", ")}`);

  // El archivo: local si está, si no el del bucket a un temporal.
  let file = plan.localFile;
  if (!file) {
    file = join(work, `${row.id}.mp4`);
    await writeFile(file, await downloadAudio(row.video_path!));
  }
  const { size } = await stat(file);

  const signed = await presign(basename(file), CONTENT_TYPE, size);
  await putMedia(signed.uploadUrl, file, CONTENT_TYPE);
  log.info(`subido (${(size / 1048576).toFixed(0)} MB)`);

  const mediaExpires = new Date(Date.now() + MEDIA_TTL_MS).toISOString();
  const requestId = requestIdFor(row.id, platforms);

  const body = buildPost({
    exportRow: {
      id: row.id,
      format: row.format,
      seconds: row.seconds,
      metadata: row.metadata,
      title: title(row),
      locale: locale(row),
    },
    platforms,
    accounts,
    mediaUrl: signed.publicUrl,
    scheduledFor: schedule.scheduledFor,
    timezone: schedule.timezone,
    publishNow: schedule.publishNow,
    visibility,
    longVideoUrl: plan.longVideoUrl,
  });

  if (body.platforms.length === 0) {
    throw new Error("ninguna cuenta activa coincide con las redes pedidas");
  }

  const created = await createPost(body, requestId);
  if (created.existed) log.info(`Zernio ya tenía este post (${created.id}); se registra ese`);

  const status = schedule.publishNow ? fromPostStatus(created.status) : "scheduled";
  const now = new Date().toISOString();

  const rows = body.platforms.map((entry) => ({
    export_id: row.id,
    meditation_id: row.meditation_id,
    platform: entry.platform,
    account_id: entry.accountId,
    provider: "zernio",
    provider_post_id: created.id,
    request_id: requestId,
    status,
    scheduled_for: schedule.publishNow ? now : schedule.scheduledFor,
    published_at: status === "published" ? now : null,
    media_url: signed.publicUrl,
    media_url_expires_at: mediaExpires,
    payload: body,
    updated_at: now,
  }));

  const { data, error } = await db()
    .from("omtana_publications")
    .upsert(rows, { onConflict: "export_id,platform,account_id" })
    .select("id, platform");
  if (error) throw new Error(`el post quedó en Zernio (${created.id}) pero no se pudo registrar: ${error.message}`);

  for (const saved of (data ?? []) as { id: string; platform: string }[]) {
    log.ok(`${saved.platform.padEnd(10)} publicación ${saved.id}`);
  }

  // Si salió ya, se traen las URLs en el acto; si no, las trae --sincronizar.
  if (schedule.publishNow) {
    await syncPost(created.id, (data ?? []).map((d: { id: string }) => d.id));
  }
}

/* ───────────────────────── sincronizar ───────────────────────── */

async function sync() {
  requireEnv("ZERNIO_API_KEY");

  const { data, error } = await db()
    .from("omtana_publications")
    .select("id, export_id, meditation_id, platform, account_id, provider_post_id, status")
    .eq("provider", "zernio")
    .in("status", OPEN_STATUSES)
    .not("provider_post_id", "is", null);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as PublicationRow[];
  if (rows.length === 0) {
    log.done("No hay publicaciones pendientes.");
    return;
  }

  const byPost = new Map<string, string[]>();
  for (const row of rows) {
    const list = byPost.get(row.provider_post_id!) ?? [];
    list.push(row.id);
    byPost.set(row.provider_post_id!, list);
  }

  log.title(`${rows.length} publicación${rows.length === 1 ? "" : "es"} en ${byPost.size} post${byPost.size === 1 ? "" : "s"}`);

  let failed = 0;
  for (const [postId, ids] of byPost) {
    try {
      await syncPost(postId, ids);
    } catch (err) {
      failed++;
      log.fail(`${postId} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log.done(failed === 0 ? "Estados al día." : `${failed} post${failed === 1 ? "" : "s"} sin sincronizar.`);
  if (failed > 0) process.exitCode = 1;
}

/**
 * Trae el estado de un post y lo reparte en sus filas. Cada red tiene su
 * propia entrada en `platforms[]`; si falta, se hereda el estado del post.
 */
async function syncPost(postId: string, publicationIds: string[]) {
  const post = await getPost(postId);

  const { data, error } = await db()
    .from("omtana_publications")
    .select("id, export_id, meditation_id, platform, account_id, provider_post_id, status")
    .in("id", publicationIds);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as PublicationRow[]) {
    const entry =
      post.platforms.find((p) => p.platform === row.platform && p.accountId === row.account_id) ??
      post.platforms.find((p) => p.platform === row.platform);

    const status = entry ? fromPlatformStatus(entry.status, post.status) : fromPostStatus(post.status);
    const url = entry?.platformPostUrl ?? null;
    const publishedAt =
      status === "published" ? entry?.publishedAt ?? post.publishedAt ?? new Date().toISOString() : null;

    const { error: updateError } = await db()
      .from("omtana_publications")
      .update({
        status,
        url,
        published_at: publishedAt,
        error: entry?.errorMessage ?? null,
        error_category: entry?.errorCategory ?? null,
        scheduled_for: post.scheduledFor ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);

    const detail = url ? ` → ${url}` : entry?.errorMessage ? ` — ${entry.errorMessage}` : "";
    const line = `${row.platform.padEnd(10)} ${status}${detail}`;
    if (status === "failed") log.fail(line);
    else if (row.status !== status) log.ok(line);
    else log.info(line);

    // YouTube sigue teniendo su columna en el export: lo que ya la lee no cambia.
    if (row.platform === "youtube" && status === "published" && url) {
      await db()
        .from("omtana_video_exports")
        .update({ youtube_url: url, published_at: publishedAt })
        .eq("id", row.export_id);
    }
  }
}

/* ───────────────────────── cancelar ───────────────────────── */

async function cancel(publicationId: string) {
  requireEnv("ZERNIO_API_KEY");

  const { data, error } = await db()
    .from("omtana_publications")
    .select("id, export_id, meditation_id, platform, account_id, provider_post_id, status")
    .eq("id", publicationId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const row = data as PublicationRow | null;
  if (!row) fatal(`No hay ninguna publicación con id ${publicationId}.`);
  if (row.status === "published") {
    fatal("Esa publicación ya salió. Zernio no la baja por API; hay que borrarla en la red.");
  }
  if (row.status === "cancelled") {
    log.done("Ya estaba cancelada.");
    return;
  }

  if (row.provider_post_id) {
    await cancelPost(row.provider_post_id);
  }

  // Un post de Zernio es una pieza: cancelarlo frena todas las redes a las que
  // iba, así que se marcan todas sus filas y no solo la que se pidió.
  const target = db().from("omtana_publications").update({ status: "cancelled", updated_at: new Date().toISOString() });
  const { data: updated, error: updateError } = await (row.provider_post_id
    ? target.eq("provider_post_id", row.provider_post_id).in("status", OPEN_STATUSES)
    : target.eq("id", row.id)
  ).select("id, platform");
  if (updateError) throw new Error(updateError.message);

  for (const u of (updated ?? []) as { id: string; platform: string }[]) {
    log.ok(`${u.platform.padEnd(10)} publicación ${u.id} cancelada`);
  }
  log.done(`Post ${row.provider_post_id ?? "(sin id en Zernio)"} cancelado.`);
}

/* ───────────────────────── consultas ───────────────────────── */

async function readyExports(format: FormatId | undefined, ids: string[]): Promise<ExportRow[]> {
  let query = db()
    .from("omtana_video_exports")
    .select("id, meditation_id, format, seconds, video_path, youtube_url, metadata, meditation:omtana_meditations(title, locale)")
    .eq("status", "ready")
    .order("created_at", { ascending: true });

  if (format) query = query.eq("format", format);
  if (ids.length > 0) query = query.in("meditation_id", ids);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ExportRow[];
}

/** `export:plataforma` de todo lo que ya tiene una fila, en cualquier estado. */
async function publishedKeys(exportIds: string[], dry: boolean): Promise<Set<string>> {
  const keys = new Set<string>();
  if (exportIds.length === 0) return keys;

  const { data, error } = await db()
    .from("omtana_publications")
    .select("export_id, platform, status")
    .in("export_id", exportIds);

  // Sin la tabla no hay dónde anotar lo que se publica, así que en serio se
  // frena; en seco se puede planear igual, avisando.
  if (error && /could not find the table/i.test(error.message)) {
    const hint = "falta la tabla omtana_publications: npm run db:push -- --solo 0007";
    if (!dry) fatal(`No se puede publicar sin registro — ${hint}.`);
    log.warn(`${hint} (en seco se sigue como si no hubiera nada publicado)`);
    return keys;
  }
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as { export_id: string; platform: string }[]) {
    keys.add(`${row.export_id}:${row.platform}`);
  }
  return keys;
}

/** URL en YouTube del 16:9 de cada meditación, para enlazarla desde los recortes. */
async function longVideoUrls(meditationIds: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (meditationIds.length === 0) return urls;

  const { data, error } = await db()
    .from("omtana_video_exports")
    .select("meditation_id, youtube_url")
    .eq("format", "youtube")
    .in("meditation_id", meditationIds)
    .not("youtube_url", "is", null);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as { meditation_id: string; youtube_url: string }[]) {
    urls.set(row.meditation_id, row.youtube_url);
  }
  return urls;
}

/**
 * El archivo como lo deja `npm run video`: `<slug>-<id8>-<formato>.mp4`. Si el
 * título cambió después de renderizar, el slug ya no coincide; se busca
 * entonces cualquiera con el mismo id y formato.
 */
async function findLocal(row: ExportRow, dir: string): Promise<string | null> {
  const id8 = row.meditation_id.slice(0, 8);
  const exact = join(dir, `${slug(title(row))}-${id8}-${row.format}.mp4`);
  if (await exists(exact)) return exact;

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const suffix = `-${id8}-${row.format}.mp4`;
  const match = names.find((name) => name.endsWith(suffix));
  return match ? join(dir, match) : null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/* ───────────────────────── opciones ───────────────────────── */

function pickPlatforms(raw: string): Platform[] {
  const list = raw.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
  const bad = list.filter((p) => !isPlatform(p));
  if (bad.length > 0) {
    fatal(`Plataforma desconocida: ${bad.join(", ")}. Usa ${PLATFORMS.join(", ")}.`);
  }
  return [...new Set(list as Platform[])];
}

function pickSchedule(args: Args): Schedule {
  const timezone = process.env.PUBLISH_TIMEZONE || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    fatal(`PUBLISH_TIMEZONE no es una zona válida: ${timezone}. Ejemplo: America/Santiago.`);
  }

  if (args.flags.has("ahora")) return { publishNow: true, timezone };

  const fixed = args.values.get("programar");
  if (fixed) {
    const at = /Z$|[+-]\d{2}:?\d{2}$/.test(fixed) ? new Date(fixed) : zonedToUtc(fixed, timezone);
    if (Number.isNaN(at.getTime())) fatal(`--programar no se entiende: ${fixed}. Ejemplo: 2026-10-01T10:00`);
    if (at.getTime() < Date.now()) fatal(`--programar apunta al pasado: ${local(at.toISOString(), timezone)}`);
    return { publishNow: false, scheduledFor: at.toISOString(), timezone };
  }

  const hours = Number(args.values.get("en") ?? DEFAULT_DELAY_HOURS);
  if (!Number.isFinite(hours) || hours < 0) fatal("--en espera horas: --en 48");

  // Al minuto, para que la hora que se muestra sea la que se manda.
  const at = new Date(Math.ceil((Date.now() + hours * 3600_000) / 60_000) * 60_000);
  return { publishNow: false, scheduledFor: at.toISOString(), timezone };
}

/**
 * "2026-10-01T10:00" en una zona → instante UTC. Se calcula el desfase de la
 * zona en ese momento y se corrige una vez por si cae en un cambio de hora.
 */
function zonedToUtc(text: string, timezone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return new Date(NaN);

  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  let guess = asUtc - offsetMs(asUtc, timezone);
  const again = asUtc - offsetMs(guess, timezone);
  if (again !== guess) guess = again;
  return new Date(guess);
}

/** Desfase de la zona respecto de UTC en un instante dado, en ms. */
function offsetMs(at: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return local - at;
}

function local(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString("es-CL", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
}

/* ───────────────────────── estados ───────────────────────── */

function fromPostStatus(status: PostStatus): string {
  switch (status) {
    case "published":
    case "partial":
    case "failed":
    case "cancelled":
    case "publishing":
    case "scheduled":
      return status;
    case "draft":
    default:
      return "queued";
  }
}

function fromPlatformStatus(status: PlatformStatus, post: PostStatus): string {
  switch (status) {
    case "published":
    case "failed":
    case "cancelled":
      return status;
    case "processing":
    case "uploading":
      return "publishing";
    case "pending":
    default:
      // Todavía no le tocó: el estado del post dice si está en cola o saliendo.
      return post === "publishing" ? "publishing" : post === "cancelled" ? "cancelled" : "scheduled";
  }
}

/* ───────────────────────── ficha ───────────────────────── */

function meditationOf(row: ExportRow) {
  return Array.isArray(row.meditation) ? row.meditation[0] : row.meditation;
}

function title(row: ExportRow): string {
  return meditationOf(row)?.title ?? row.metadata?.title ?? row.meditation_id;
}

function locale(row: ExportRow): string {
  return meditationOf(row)?.locale ?? "es";
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
