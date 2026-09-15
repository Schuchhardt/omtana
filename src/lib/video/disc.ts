/**
 * El disco que respira, cuadro a cuadro.
 *
 * Es el mismo de la app: un halo con degradado radial que se agranda al
 * inhalar y se achica al soltar, dentro de un anillo fijo que marca el tamaño
 * de los pulmones llenos. En el navegador eso es una transformación CSS; acá
 * hay que entregarle cuadros a ffmpeg.
 *
 * No se rasteriza un cuadro por frame — serían diez mil PNG por video. Se
 * rasterizan 61 tamaños del disco, una sola vez, y la animación es una lista
 * de concatenación que dice qué tamaño toca en cada cuadro. Un video de quince
 * minutos pesa, en disco, 61 imágenes y un archivo de texto.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BreathingStep } from "../breathing";
import { discLevel } from "../breathing";
import type { Theme } from "./brand";

/** Cuadros por segundo del disco. El movimiento es lento; no necesita más. */
const FPS = 12;
/** Cuántos tamaños distintos se rasterizan. A 61 el salto no se ve. */
const LEVELS = 61;

/**
 * Respiración de fondo mientras corre la meditación.
 *
 * Son los mismos doce segundos de `--animate-breathe` en `globals.css`, y el
 * recorrido es más corto que el del ejercicio: acá el disco acompaña, no guía.
 */
const IDLE_PERIOD = 12;
const IDLE_FROM = 0.38;
const IDLE_TO = 0.86;

export interface DiscTrack {
  /** Lista para `ffmpeg -f concat`. */
  concatFile: string;
  fps: number;
  /** Lado del cuadro, en píxeles. */
  size: number;
}

export interface DiscOptions {
  work: string;
  theme: Theme;
  radius: number;
  totalSeconds: number;
  /** La grilla del ejercicio, si el video abre con respiración guiada. */
  steps: BreathingStep[];
  /** Cuánto dura esa parte; después de ahí el disco pasa a respirar solo. */
  breathingSeconds: number;
  /** Desde qué segundo de la sesión arranca el video (recortes de redes). */
  offsetSeconds?: number;
}

/**
 * La rejilla que convierte el espectro en barras.
 *
 * ffmpeg dibuja el espectro como una silueta continua; la onda del reproductor
 * son barras separadas. Esta máscara — franjas opacas con hueco entre medio —
 * se multiplica contra el espectro y deja justo eso.
 */
export async function renderBarMask(
  work: string,
  width: number,
  height: number,
  bars: number,
): Promise<string> {
  const sharp = (await import("sharp")).default;
  // Los bordes se calculan igual que el estirado sin interpolación del
  // espectro: si la franja no cae exactamente sobre su bloque, las barras
  // salen de anchos distintos y se nota como un latido en la onda.
  const rects = Array.from({ length: bars }, (_, i) => {
    const from = Math.round((i * width) / bars);
    const to = Math.round(((i + 1) * width) / bars);
    const inset = Math.max(1, Math.round((to - from) * 0.19));
    const w = Math.max(1, to - from - inset * 2);
    return `<rect x="${from + inset}" y="0" width="${w}" height="${height}" fill="#ffffff"/>`;
  }).join("");

  const file = join(work, "barras.png");
  await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#000000"/>${rects}</svg>`,
    ),
  )
    .png()
    .toFile(file);

  return file;
}

export async function renderDisc(opts: DiscOptions): Promise<DiscTrack> {
  const size = opts.radius * 2;
  const dir = join(opts.work, "disco");
  await mkdir(dir, { recursive: true });

  const files: string[] = [];
  for (let i = 0; i < LEVELS; i++) {
    const level = i / (LEVELS - 1);
    const file = join(dir, `nivel-${String(i).padStart(2, "0")}.png`);
    await rasterize(file, size, level, opts.theme);
    files.push(file);
  }

  const offset = opts.offsetSeconds ?? 0;
  const frames = Math.max(1, Math.ceil(opts.totalSeconds * FPS));
  const lines: string[] = [];
  let last = "";

  for (let frame = 0; frame < frames; frame++) {
    const time = offset + frame / FPS;
    const level =
      time < opts.breathingSeconds && opts.steps.length > 0
        ? discLevel(opts.steps, time)
        : idleLevel(time - opts.breathingSeconds);

    last = files[Math.round(level * (LEVELS - 1))];
    lines.push(`file '${last}'`, `duration ${(1 / FPS).toFixed(5)}`);
  }
  // El demuxer ignora la duración del último archivo, así que se repite: sin
  // esto el video pierde el cuadro final y termina un parpadeo antes.
  lines.push(`file '${last}'`);

  const concatFile = join(opts.work, "disco.txt");
  await writeFile(concatFile, `${lines.join("\n")}\n`);

  return { concatFile, fps: FPS, size };
}

function idleLevel(time: number): number {
  const phase = 0.5 - 0.5 * Math.cos((2 * Math.PI * Math.max(0, time)) / IDLE_PERIOD);
  return IDLE_FROM + (IDLE_TO - IDLE_FROM) * phase;
}

/**
 * Un tamaño del disco.
 *
 * El degradado va dentro del círculo y no en el lienzo, así que al achicarse
 * el halo se achica con él — igual que en la app, donde la transformación
 * arrastra el fondo del elemento.
 */
async function rasterize(file: string, size: number, level: number, theme: Theme): Promise<void> {
  const sharp = (await import("sharp")).default;
  const r = size / 2;
  const radius = (r - 2) * (0.42 + 0.58 * level);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="halo">
      <stop offset="0%" stop-color="${theme.disc}" stop-opacity="0.82"/>
      <stop offset="46%" stop-color="${theme.disc}" stop-opacity="0.5"/>
      <stop offset="74%" stop-color="${theme.disc}" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="${theme.disc}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${r}" cy="${r}" r="${r - 1.5}" fill="none" stroke="${theme.discRing}" stroke-opacity="0.32" stroke-width="1.6"/>
  <circle cx="${r}" cy="${r}" r="${radius.toFixed(2)}" fill="url(#halo)"/>
</svg>`;

  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
}
