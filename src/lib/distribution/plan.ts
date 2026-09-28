/**
 * Reglas de publicación a redes: a qué red va cada formato, cómo se adapta la
 * ficha guardada a cada una y cómo se arma el post para Zernio.
 *
 * Todo es puro — sin red ni base — para poder mirarlo en seco. La ficha
 * (`metadata` en `omtana_video_exports`) se escribió pensando en YouTube; acá
 * se recorta y se limpia para las demás sin volver a calcular nada.
 */
import { createHash } from "node:crypto";
import type { FormatId } from "../video/brand";
import { SITE, siteCta, type VideoCopy } from "../video/copy";
import {
  facebookData,
  instagramData,
  TIKTOK_SETTINGS,
  youtubeData,
  type CreatePostBody,
  type PostPlatform,
  type YouTubeVisibility,
  type ZernioAccount,
} from "./zernio";

export type Platform = "youtube" | "instagram" | "tiktok" | "facebook" | "threads";

export const PLATFORMS: readonly Platform[] = ["youtube", "instagram", "tiktok", "facebook", "threads"];

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

/**
 * A qué redes va cada formato. El 16:9 es solo para YouTube; el 9:16 es el
 * formato nativo de reels, shorts y TikTok; el 1:1 lo acepta el feed de
 * Instagram y Threads, pero no Reels ni TikTok, que lo estirarían.
 */
export function platformsFor(format: FormatId): Platform[] {
  switch (format) {
    case "youtube":
      return ["youtube"];
    case "vertical":
      return ["youtube", "instagram", "tiktok", "facebook", "threads"];
    case "cuadrado":
      return ["instagram", "threads"];
  }
}

/** Caracteres de texto que acepta cada red. YouTube da 5000; se deja margen. */
export const CONTENT_LIMITS: Record<Platform, number> = {
  youtube: 4900,
  instagram: 2200,
  tiktok: 2200,
  facebook: 2200,
  threads: 500,
};

/** Hasta acá YouTube trata un 9:16 como Short. */
const SHORT_MAX_SECONDS = 180;
const SHORT_TAG = "#Shorts";

/** "La sesión completa: <url>", para los recortes que salen de un video largo. */
const FULL_SESSION: Record<string, string> = {
  es: "La sesión completa:",
  en: "The full session:",
  pt: "A sessão completa:",
};

export interface CopyOptions {
  locale: string;
  /** Qué lleva la pieza; si no se sabe, se infiere del formato. */
  piece?: "completa" | "respiracion" | "meditacion";
  seconds: number;
  /** URL del video largo ya publicado, para enlazarlo desde los recortes. */
  longVideoUrl?: string;
}

export interface PlatformCopy {
  title: string;
  content: string;
  /** Solo YouTube las usa; en las demás va vacío. */
  tags: string[];
}

/**
 * Adapta la ficha de un export a una red.
 *
 * La descripción guardada termina con la línea de hashtags y lleva el llamado
 * a la acción en el medio. Se separan las dos cosas del cuerpo para que, si
 * hay que recortar (Threads da 500 caracteres), el recorte se lleve texto y
 * no el enlace ni las etiquetas.
 */
export function platformCopy(copy: Partial<VideoCopy> | null, platform: Platform, opts: CopyOptions): PlatformCopy {
  const isShort = platform === "youtube" && opts.seconds > 0 && opts.seconds <= SHORT_MAX_SECONDS;
  const ctaPhrase = siteCta(opts.locale);
  const site = `https://${SITE}`;

  let title = (copy?.title ?? "").trim();
  if (!isShort) title = title.replace(new RegExp(`\\s*·\\s*${SHORT_TAG}\\s*$`, "i"), "").trim();

  const lines = fixSiteUrl(copy?.description ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));

  // Las líneas que son solo hashtags salen del cuerpo: se reponen al final
  // desde `copy.hashtags`, ya filtradas para la red.
  const body = lines.filter((line) => !isHashtagLine(line));

  // El llamado a la acción se saca del cuerpo y va a la cola, protegido del
  // recorte. Si la ficha no lo traía, se agrega igual.
  const ctaIndex = body.findIndex((line) => line.includes(ctaPhrase));
  const cta = ctaIndex >= 0 ? body.splice(ctaIndex, 1)[0] : `${ctaPhrase} ${site}`;

  const tail: string[] = [cta];

  const piece = opts.piece ?? "completa";
  const isCut = piece !== "completa" || opts.seconds <= SHORT_MAX_SECONDS;
  if (opts.longVideoUrl && isCut && !body.some((line) => line.includes(opts.longVideoUrl!))) {
    tail.push(`${FULL_SESSION[opts.locale] ?? FULL_SESSION.es} ${opts.longVideoUrl}`);
  }

  let hashtags = (copy?.hashtags ?? []).filter((tag) => tag.toLowerCase() !== SHORT_TAG.toLowerCase());
  if (isShort) hashtags = [...hashtags, SHORT_TAG];
  if (hashtags.length > 0) tail.push(hashtags.join(" "));

  const tailText = tail.join("\n");
  const limit = CONTENT_LIMITS[platform];
  const bodyText = trimWords(collapse(body), Math.max(0, limit - tailText.length - 2));

  const content = bodyText ? `${bodyText}\n\n${tailText}` : tailText;

  return {
    title,
    content: content.length <= limit ? content : trimWords(content, limit),
    tags: platform === "youtube" ? (copy?.tags ?? []) : [],
  };
}

/**
 * Por qué una pieza no cabe en una red, o `null` si cabe. Son los límites
 * publicados de cada una; mandar algo fuera de rango falla del lado de
 * Zernio horas después, cuando ya nadie está mirando.
 */
export function fitsPlatform(platform: Platform, format: FormatId, seconds: number): string | null {
  if (!platformsFor(format).includes(platform)) {
    return `el formato ${format} no va a ${platform}`;
  }

  switch (platform) {
    case "youtube":
      return null;
    case "instagram":
      if (seconds < 3) return "Instagram Reels pide al menos 3 segundos";
      if (seconds > 90) return `Instagram Reels acepta hasta 90 segundos y esta dura ${seconds}`;
      return null;
    case "facebook":
      if (seconds < 3) return "Facebook Reels pide al menos 3 segundos";
      if (seconds > 60) return `Facebook Reels acepta hasta 60 segundos y esta dura ${seconds}`;
      return null;
    case "tiktok":
      if (seconds < 3) return "TikTok pide al menos 3 segundos";
      if (seconds > 600) return `TikTok acepta hasta 10 minutos y esta dura ${seconds} segundos`;
      return null;
    case "threads":
      if (seconds > 300) return `Threads acepta hasta 5 minutos y esta dura ${seconds} segundos`;
      return null;
  }
}

/* ───────────────────────── el post ───────────────────────── */

export interface PublishableExport {
  id: string;
  format: FormatId;
  seconds: number;
  metadata: Partial<VideoCopy> | null;
  title: string;
  locale: string;
  piece?: CopyOptions["piece"];
}

export interface BuildPostInput {
  exportRow: PublishableExport;
  platforms: Platform[];
  accounts: ZernioAccount[];
  mediaUrl: string;
  thumbnailUrl?: string;
  /** ISO. Si falta y no es `publishNow`, Zernio lo deja en borrador. */
  scheduledFor?: string;
  timezone: string;
  publishNow?: boolean;
  /** YouTube. Zernio no puede pasar un video de privado a público después. */
  visibility?: YouTubeVisibility;
  longVideoUrl?: string;
}

/**
 * Arma el cuerpo de `createPost`. Un solo post con una entrada por cuenta:
 * cada red recibe su propio texto en `customContent`, y el `content` de raíz
 * es la versión más corta, que sirve de respaldo en cualquiera.
 */
export function buildPost(input: BuildPostInput): CreatePostBody {
  const { exportRow, platforms, accounts } = input;
  const visibility = input.visibility ?? "public";
  const opts: CopyOptions = {
    locale: exportRow.locale,
    piece: exportRow.piece ?? (exportRow.format === "youtube" ? "completa" : undefined),
    seconds: exportRow.seconds,
    longVideoUrl: input.longVideoUrl,
  };

  const entries: PostPlatform[] = [];
  let shortest: string | null = null;
  let tags: string[] = [];

  for (const platform of platforms) {
    const copy = platformCopy(exportRow.metadata, platform, opts);
    const title = copy.title || exportRow.title;
    if (shortest === null || copy.content.length < shortest.length) shortest = copy.content;
    if (platform === "youtube") tags = copy.tags;

    for (const account of accounts.filter((a) => a.platform === platform && a.isActive)) {
      entries.push({
        platform,
        accountId: account._id,
        customContent: copy.content,
        platformSpecificData: platformData(platform, title, visibility),
      });
    }
  }

  const body: CreatePostBody = {
    content: shortest ?? "",
    mediaItems: [{ type: "video", url: input.mediaUrl, ...(input.thumbnailUrl ? { thumbnail: input.thumbnailUrl } : {}) }],
    platforms: entries,
  };

  if (tags.length > 0) body.tags = tags;
  if (platforms.includes("tiktok")) body.tiktokSettings = TIKTOK_SETTINGS;

  if (input.publishNow) {
    body.publishNow = true;
  } else if (input.scheduledFor) {
    body.scheduledFor = input.scheduledFor;
    body.timezone = input.timezone;
  }

  return body;
}

function platformData(platform: Platform, title: string, visibility: YouTubeVisibility) {
  switch (platform) {
    case "youtube":
      return youtubeData(title, visibility);
    case "instagram":
      return instagramData();
    case "facebook":
      return facebookData(title);
    default:
      return undefined;
  }
}

/**
 * Id de idempotencia determinista: el mismo export a las mismas redes da el
 * mismo UUID, así que repetir el comando no duplica el post. Es un UUID v5 a
 * mano (SHA-1 con los bits de versión y variante), sin dependencias.
 */
export function requestIdFor(exportId: string, platforms: Platform[]): string {
  const hash = createHash("sha1")
    .update(`omtana:zernio:${exportId}:${[...platforms].sort().join(",")}`)
    .digest("hex");
  const hex =
    hash.slice(0, 12) +
    "5" +
    hash.slice(13, 16) +
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) +
    hash.slice(17, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/* ───────────────────────── texto ───────────────────────── */

/**
 * Una ficha generada en una máquina de desarrollo puede traer `localhost` en
 * el enlace. Al canal no puede llegar eso.
 */
function fixSiteUrl(text: string): string {
  return text.replace(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s)]*/gi, `https://${SITE}`);
}

function isHashtagLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.split(/\s+/).every((word) => word.startsWith("#"));
}

/** Quita las líneas vacías sobrantes al principio, al final y las repetidas. */
function collapse(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Recorta en límite de palabra y marca el corte con puntos suspensivos. */
function trimWords(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "";
  const cut = text.slice(0, max - 1);
  const at = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
