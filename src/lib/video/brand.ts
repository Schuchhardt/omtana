/**
 * La marca, traducida a píxeles y a argumentos de ffmpeg.
 *
 * El video es la misma escena del reproductor — disco que respira, onda que
 * sigue la voz, texto abajo, wordmark arriba — reencuadrada para cada destino.
 * Por eso los colores no se eligen acá: salen de los mismos tokens que usa la
 * app en `globals.css`, y el tema oscuro es literalmente el bloque que ese
 * archivo rotula "frames de video".
 */
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type ThemeName = "oscuro" | "claro";
export type FormatId = "youtube" | "vertical" | "cuadrado";

export interface Theme {
  /** Fondo, en dos tonos: el degradado lento se mueve entre ellos. */
  background: string;
  backgroundDeep: string;
  /** Halo detrás del disco. */
  glow: string;
  disc: string;
  discRing: string;
  wave: string;
  text: string;
  textSoft: string;
  textFaint: string;
  bar: string;
  barTrack: string;
  /** Qué versión del wordmark se superpone. */
  logo: "white" | "black";
}

export const THEMES: Record<ThemeName, Theme> = {
  /* --color-night y compañía: el bloque oscuro de la marca. */
  oscuro: {
    background: "#231c17",
    backgroundDeep: "#151110",
    glow: "#463226",
    disc: "#c4a98f",
    discRing: "#8e7561",
    wave: "#c4a98f",
    text: "#f6f1e9",
    textSoft: "#c4b9aa",
    textFaint: "#a79c8d",
    bar: "#b4643c",
    barTrack: "#38302a",
    logo: "white",
  },
  /* La pantalla del reproductor tal cual, para piezas de día. */
  claro: {
    background: "#f1eadf",
    backgroundDeep: "#e6dbc9",
    glow: "#fdf7ef",
    disc: "#c9a489",
    discRing: "#b4643c",
    wave: "#b4643c",
    text: "#241f1a",
    textSoft: "#4a4239",
    textFaint: "#8e8376",
    bar: "#b4643c",
    barTrack: "#e2d6c4",
    logo: "black",
  },
};

export interface Format {
  id: FormatId;
  width: number;
  height: number;
  /** Cómo se llama el archivo y qué se ve en el informe. */
  label: string;
  /**
   * Segundos máximos de la pieza, o `null` si lleva la sesión entera.
   *
   * Las de redes son un recorte corto y de una sola cosa: o el ejercicio de
   * respiración o un pasaje de la meditación. Las dos juntas no caben en un
   * minuto sin quedar a medias las dos, y para eso está el 16:9.
   */
  maxSeconds: number | null;
}

export const FORMATS: Record<FormatId, Format> = {
  youtube: { id: "youtube", width: 1920, height: 1080, label: "YouTube 16:9", maxSeconds: null },
  vertical: { id: "vertical", width: 1080, height: 1920, label: "Vertical 9:16", maxSeconds: 45 },
  cuadrado: { id: "cuadrado", width: 1080, height: 1080, label: "Cuadrado 1:1", maxSeconds: 45 },
};

export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[];

/**
 * Dónde va cada cosa.
 *
 * Todo se expresa como fracción del alto y después se redondea a píxel: así el
 * 9:16 no es el 16:9 estirado, sino la misma escena con más aire arriba y
 * abajo, que es como se ve bien en un teléfono.
 */
export interface Layout {
  /** Centro del disco y de la onda. */
  centerY: number;
  discRadius: number;
  waveWidth: number;
  waveHeight: number;
  /** Cuántas barras tiene la onda. En la app son 72. */
  waveBars: number;
  /** Alto de la banda de subtítulos, en píxeles desde arriba. */
  subtitleY: number;
  subtitleSize: number;
  /** Margen lateral de los subtítulos, para que no toquen el borde. */
  subtitleMargin: number;
  titleY: number;
  titleSize: number;
  metaY: number;
  metaSize: number;
  barY: number;
  barWidth: number;
  barHeight: number;
  logoWidth: number;
  logoX: number;
  logoY: number;
}

export function layoutFor(format: Format): Layout {
  const { width: w, height: h } = format;
  const vertical = h > w;

  const centerY = Math.round(h * (vertical ? 0.36 : 0.4));
  const discRadius = Math.round(Math.min(w, h) * (vertical ? 0.2 : 0.17));

  return {
    centerY,
    discRadius,
    waveWidth: Math.round(w * (vertical ? 0.86 : 0.66)),
    waveHeight: Math.round(h * (vertical ? 0.075 : 0.13)),
    waveBars: vertical ? 48 : 72,
    subtitleY: Math.round(h * (vertical ? 0.63 : 0.66)),
    subtitleSize: Math.round(h * (vertical ? 0.031 : 0.044)),
    subtitleMargin: Math.round(w * (vertical ? 0.09 : 0.17)),
    titleY: Math.round(h * (vertical ? 0.85 : 0.83)),
    titleSize: Math.round(h * (vertical ? 0.026 : 0.041)),
    metaY: Math.round(h * (vertical ? 0.885 : 0.885)),
    metaSize: Math.round(h * (vertical ? 0.017 : 0.027)),
    barY: Math.round(h * 0.945),
    barWidth: Math.round(w * (vertical ? 0.74 : 0.42)),
    barHeight: Math.max(2, Math.round(h * 0.0022)),
    logoWidth: Math.round(w * (vertical ? 0.3 : 0.14)),
    logoX: vertical ? Math.round(w * 0.35) : Math.round(w * 0.055),
    logoY: Math.round(h * (vertical ? 0.075 : 0.085)),
  };
}

/* ───────────────────────── tipografía ───────────────────────── */

const FONT_DIR = "assets/fonts";
const FONT_BASE = "https://github.com/indestructible-type/Jost/raw/master/fonts/ttf";

export interface Fonts {
  /** Jost Light: los subtítulos y el pie. */
  light: string;
  /** Jost Book: el título, que necesita un poco más de cuerpo. */
  book: string;
}

/**
 * Baja Jost la primera vez y la deja en `assets/fonts`, que no se versiona.
 *
 * Sin tipografía no hay pieza: el texto es la mitad del video, así que esto
 * falla en vez de seguir sin él — al contrario que el exportador viejo, que
 * dejaba un video mudo de rótulos y no se notaba hasta verlo.
 */
export async function ensureFonts(): Promise<Fonts> {
  const [light, book] = await Promise.all([
    ensureFont("Jost-300-Light.ttf"),
    ensureFont("Jost-400-Book.ttf"),
  ]);
  return { light, book };
}

async function ensureFont(file: string): Promise<string> {
  const path = join(FONT_DIR, file);
  try {
    await access(path);
    return resolve(path);
  } catch {
    /* se baja abajo */
  }

  const res = await fetch(`${FONT_BASE}/${file}`);
  if (!res.ok) {
    throw new Error(
      `No se pudo bajar la tipografía ${file} (${res.status}). ` +
        `Déjala a mano en ${path} y vuelve a correr.`,
    );
  }
  await mkdir(FONT_DIR, { recursive: true });
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  return resolve(path);
}

/* ───────────────────────── logo ───────────────────────── */

/** ffmpeg no lee SVG, así que el wordmark se rasteriza una vez por tema. */
export async function ensureLogo(theme: Theme, width: number): Promise<string> {
  const png = `public/brand/omtana-wordmark-${theme.logo}-${width}.png`;
  try {
    await access(png);
    return resolve(png);
  } catch {
    /* se genera abajo */
  }

  const sharp = (await import("sharp")).default;
  const svg = await readFile(`public/brand/omtana-wordmark-${theme.logo}.svg`);
  await sharp(svg, { density: 900 }).resize({ width }).png().toFile(png);
  return resolve(png);
}

/* ───────────────────────── utilidades ───────────────────────── */

/** ffmpeg quiere 0xRRGGBB; la marca está escrita en #RRGGBB. */
export function ff(color: string): string {
  return `0x${color.replace("#", "")}`;
}

/** Y en los subtítulos ASS el color va al revés y con transparencia: &HAABBGGRR. */
export function ass(color: string, alpha = 0): string {
  const hex = color.replace("#", "");
  const r = hex.slice(0, 2);
  const g = hex.slice(2, 4);
  const b = hex.slice(4, 6);
  const a = alpha.toString(16).padStart(2, "0").toUpperCase();
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

/** drawtext trata ' : \ y % como sintaxis. */
export function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "’")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

export function slug(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "omtana"
  );
}
