/**
 * Cliente mínimo de la API de Zernio (https://docs.zernio.com), con fetch nativo.
 *
 * Sin SDK a propósito: se usan cinco llamadas y el SDK arrastra dependencias
 * que después hay que mantener. Lo que sí se copia de la doc es lo que cuesta
 * descubrir a ciegas: los nombres exactos de los campos, cómo se ve una
 * respuesta repetida y qué datos exige cada red.
 *
 * Flujo: presign → PUT del archivo → createPost con la URL pública → getPost
 * para seguirlo. La URL pública vive siete días en almacenamiento temporal; al
 * publicarse, Zernio copia el archivo a su almacenamiento permanente.
 */
import { readFile } from "node:fs/promises";

const BASE_URL = "https://zernio.com/api/v1";

/** Intentos por llamada y espera base entre ellos (crece por dos). */
const ATTEMPTS = 3;
const BACKOFF_MS = 1500;

/** Una llamada de API no debería tardar más que esto; la subida del archivo sí. */
const API_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 10 * 60_000;

/** La URL pública de un archivo subido vive siete días en almacenamiento temporal. */
export const MEDIA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class ZernioError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ZernioError";
    this.status = status;
    this.body = body;
  }
}

/* ───────────────────────── tipos ───────────────────────── */

export interface ZernioAccount {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  isActive: boolean;
  needsReconnection?: boolean;
}

export interface PresignResult {
  uploadUrl: string;
  publicUrl: string;
  /** Segundos de vida de `uploadUrl` (una hora), no de `publicUrl`. */
  expiresIn: number;
}

export interface MediaItem {
  type: "video" | "image";
  url: string;
  thumbnail?: string;
}

export interface PostPlatform {
  platform: string;
  accountId: string;
  platformSpecificData?: Record<string, unknown>;
  /** Texto que reemplaza a `content` solo en esta red. */
  customContent?: string;
}

export interface TikTokSettings {
  privacy_level: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
  allow_comment: boolean;
  allow_duet: boolean;
  allow_stitch: boolean;
  content_preview_confirmed: boolean;
  express_consent_given: boolean;
}

export interface CreatePostBody {
  content: string;
  tags?: string[];
  mediaItems: MediaItem[];
  platforms: PostPlatform[];
  publishNow?: boolean;
  /** ISO 8601. Si no lleva Z ni offset, se interpreta en `timezone`. */
  scheduledFor?: string;
  timezone?: string;
  tiktokSettings?: TikTokSettings;
}

export type PostStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "partial"
  | "failed"
  | "cancelled";

export type PlatformStatus =
  | "pending"
  | "processing"
  | "uploading"
  | "published"
  | "failed"
  | "cancelled";

export interface ZernioPostPlatform {
  platform: string;
  accountId?: string;
  status: PlatformStatus;
  platformPostUrl?: string;
  platformPostId?: string;
  errorMessage?: string;
  errorCategory?: string;
  publishedAt?: string;
}

export interface ZernioPost {
  _id: string;
  status: PostStatus;
  scheduledFor?: string | null;
  publishedAt?: string | null;
  platforms: ZernioPostPlatform[];
}

export interface CreatePostResult {
  id: string;
  status: PostStatus;
  /** `true` si Zernio ya tenía este post y devolvió el existente. */
  existed: boolean;
}

/* ───────────────────────── datos por plataforma ───────────────────────── */

export type YouTubeVisibility = "public" | "private" | "unlisted";

/** YouTube corta el título en 100 caracteres. */
export const YOUTUBE_TITLE_MAX = 100;

/**
 * La descripción va en `content` y las etiquetas en `tags`, no acá. Shorts se
 * detectan solos: un 9:16 de tres minutos o menos entra como Short.
 * `containsSyntheticMedia` va en verdadero porque la voz es sintética y
 * YouTube pide declararlo; `categoryId` 22 es "People & Blogs", donde vive el
 * resto del contenido de este tipo.
 */
export function youtubeData(title: string, visibility: YouTubeVisibility): Record<string, unknown> {
  return {
    title: clip(title, YOUTUBE_TITLE_MAX),
    visibility,
    madeForKids: false,
    containsSyntheticMedia: true,
    categoryId: "22",
  };
}

/** Reels de Instagram: 9:16, 3–90 s, hasta 300 MB. También en el feed. */
export function instagramData(): Record<string, unknown> {
  return { shareToFeed: true };
}

/** Reels de Facebook: 3–60 s. Sin `contentType: 'reel'` entra como video normal. */
export function facebookData(title: string): Record<string, unknown> {
  return { contentType: "reel", title: clip(title, YOUTUBE_TITLE_MAX) };
}

/**
 * TikTok exige que se declaren estas opciones en cada publicación por API.
 * Las dos últimas son las confirmaciones que la API pide para publicar
 * directamente (que se vio la previsualización y que hay consentimiento).
 */
export const TIKTOK_SETTINGS: TikTokSettings = {
  privacy_level: "PUBLIC_TO_EVERYONE",
  allow_comment: true,
  allow_duet: true,
  allow_stitch: true,
  content_preview_confirmed: true,
  express_consent_given: true,
};

/* ───────────────────────── llamadas ───────────────────────── */

export async function listAccounts(): Promise<ZernioAccount[]> {
  const { body } = await request<{ accounts?: ZernioAccount[] } | ZernioAccount[]>("GET", "/accounts");
  // La doc dice `{ accounts: [...] }`; se acepta también la lista pelada por si
  // la respuesta cambia de envoltorio.
  return Array.isArray(body) ? body : (body.accounts ?? []);
}

export async function presign(fileName: string, contentType: string, size?: number): Promise<PresignResult> {
  const { body } = await request<PresignResult>("POST", "/media/presign", {
    // `filename` en minúscula: así lo espera la API.
    body: { filename: fileName, contentType, ...(size ? { size } : {}) },
  });
  if (!body?.uploadUrl || !body?.publicUrl) {
    throw new ZernioError("Zernio no devolvió las URLs de subida.", 200, body);
  }
  return body;
}

/**
 * Sube el archivo a la URL firmada. Va al almacenamiento, no a la API: sin
 * Authorization y con el mismo Content-Type que se pidió en el presign.
 *
 * Se lee entero a memoria: los cortos pesan pocos MB y el largo ronda los
 * 120 MB, que una máquina de escritorio aguanta sin problema.
 */
export async function putMedia(uploadUrl: string, filePath: string, contentType: string): Promise<void> {
  const data = await readFile(filePath);
  let last = "";

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType, "Content-Length": String(data.byteLength) },
        body: new Uint8Array(data),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      await wait(BACKOFF_MS * 2 ** (attempt - 1));
      continue;
    }

    if (res.ok) return;

    const text = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status < 500 && res.status !== 429) {
      throw new ZernioError(`La subida del archivo fue rechazada (${res.status}): ${text}`, res.status, text);
    }
    last = `${res.status}: ${text}`;
    await wait(retryAfter(res) ?? BACKOFF_MS * 2 ** (attempt - 1));
  }

  throw new ZernioError(`La subida del archivo falló tras ${ATTEMPTS} intentos: ${last}`, 0, last);
}

/**
 * Crea el post. `requestId` va en `Idempotency-Key` y en `x-request-id`: el
 * primero hace que repetir la llamada dentro de 24 horas devuelva el post
 * original sin mirar el cuerpo; el segundo cubre el caso de que el primero no
 * se reconozca. Si Zernio responde que ya existía — 200 con `existingPost`, o
 * 409 con `existingPostId` por contenido idéntico a la misma cuenta — se
 * devuelve ese id como éxito: el post está, que es lo que importa.
 */
export async function createPost(body: CreatePostBody, requestId: string): Promise<CreatePostResult> {
  const { status, body: res } = await request<CreateResponse>("POST", "/posts", {
    body,
    headers: { "Idempotency-Key": requestId, "x-request-id": requestId },
    accept: [409],
  });

  if (status === 409) {
    const existing = res?.details?.existingPostId ?? res?.existingPostId;
    if (existing) return { id: existing, status: "scheduled", existed: true };
    throw new ZernioError(
      `Zernio rechazó el post por duplicado (409) sin decir cuál era el original: ${short(res)}`,
      409,
      res,
    );
  }

  if (res?.existingPost?._id) {
    return { id: res.existingPost._id, status: res.existingPost.status ?? "scheduled", existed: true };
  }

  const post = res?.post;
  if (!post?._id) {
    throw new ZernioError(`Zernio no devolvió el id del post creado: ${short(res)}`, status, res);
  }
  return { id: post._id, status: post.status ?? "scheduled", existed: false };
}

interface CreateResponse {
  post?: { _id: string; status?: PostStatus };
  existingPost?: { _id: string; status?: PostStatus };
  existingPostId?: string;
  error?: string;
  details?: { existingPostId?: string };
}

export async function getPost(id: string): Promise<ZernioPost> {
  const { body } = await request<{ post?: ZernioPost }>("GET", `/posts/${encodeURIComponent(id)}`);
  if (!body?.post) throw new ZernioError(`Zernio no devolvió el post ${id}.`, 200, body);
  return body.post;
}

/**
 * Cancela un post que aún no salió.
 *
 * La guía de ciclo de vida (docs.zernio.com/guides/post-lifecycle) dice que
 * `DELETE /v1/posts/{id}` vale para cualquier estado salvo `published`, y que
 * un post publicado devuelve 400. El índice de la doc menciona además un
 * `POST /v1/posts/{id}/cancel` cuya página no se pudo abrir, así que se usa
 * el borrado, que sí está documentado; para un post programado son lo mismo.
 */
export async function cancelPost(id: string): Promise<void> {
  await request<unknown>("DELETE", `/posts/${encodeURIComponent(id)}`);
}

/* ───────────────────────── transporte ───────────────────────── */

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** Códigos de error que se devuelven al llamador en vez de lanzarse. */
  accept?: number[];
}

function apiKey(): string {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new ZernioError("Falta ZERNIO_API_KEY (Zernio → Settings → API keys).", 0, null);
  if (!/^sk_[0-9a-f]{64}$/i.test(key)) {
    throw new ZernioError(
      "ZERNIO_API_KEY no tiene la forma esperada: `sk_` seguido de 64 caracteres hexadecimales.",
      0,
      null,
    );
  }
  return key;
}

/**
 * Una llamada con reintentos: 429 (respetando Retry-After) y 5xx se repiten
 * hasta tres veces con espera creciente; el resto de los errores sale al
 * primer intento porque insistir no los arregla.
 */
async function request<T>(
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<{ status: number; body: T }> {
  const key = apiKey();
  let last = "";

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      if (attempt < ATTEMPTS) await wait(BACKOFF_MS * 2 ** (attempt - 1));
      continue;
    }

    const body = await parseBody(res);

    if (res.ok || opts.accept?.includes(res.status)) {
      return { status: res.status, body: body as T };
    }

    if (res.status === 429 || res.status >= 500) {
      last = `${res.status}: ${short(body)}`;
      if (attempt < ATTEMPTS) await wait(retryAfter(res) ?? BACKOFF_MS * 2 ** (attempt - 1));
      continue;
    }

    throw new ZernioError(describe(method, path, res.status, body), res.status, body);
  }

  throw new ZernioError(`Zernio no respondió bien a ${method} ${path} tras ${ATTEMPTS} intentos: ${last}`, 0, last);
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describe(method: string, path: string, status: number, body: unknown): string {
  const detail = short(body);
  switch (status) {
    case 401:
      return `Zernio rechazó la clave (401). Revisa ZERNIO_API_KEY. ${detail}`;
    case 402:
      return `El plan de Zernio no alcanza para esta operación (402): ${detail}`;
    case 403:
      return `Zernio no permite ${method} ${path} con esta clave (403): ${detail}`;
    case 404:
      return `Zernio no encontró ${path} (404): ${detail}`;
    case 400:
    case 422:
      return `Zernio rechazó los datos de ${method} ${path} (${status}): ${detail}`;
    default:
      return `Zernio respondió ${status} a ${method} ${path}: ${detail}`;
  }
}

/** El mensaje de error de la API, o el cuerpo recortado si no lo trae. */
function short(body: unknown): string {
  if (body && typeof body === "object") {
    const b = body as { error?: unknown; message?: unknown };
    const msg = typeof b.error === "string" ? b.error : typeof b.message === "string" ? b.message : null;
    if (msg) return msg.slice(0, 300);
  }
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  return text.slice(0, 300);
}

/** `Retry-After` viene en segundos o como fecha HTTP; se devuelve en ms. */
function retryAfter(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
