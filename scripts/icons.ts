/**
 * Genera los PNG del manifiesto a partir del símbolo vectorial de la marca.
 *
 *   npm run icons
 *
 * Se corre a mano cuando cambia el símbolo, no en cada build: los PNG viven en
 * el repo para que el manifiesto siga sirviendo aunque el build no tenga sharp
 * (es una dependencia de desarrollo).
 *
 * `public/brand/*.png` está en .gitignore, por eso estos íconos van en
 * `public/icons/`.
 */
import { log } from "./_bootstrap";
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SOURCE = "public/brand/omtana-symbol-black.svg";
const OUT = "public/icons";

/** Arena del sitio: el ícono se ve como una prolongación de la app, no un recorte. */
const SAND = { r: 246, g: 241, b: 233, alpha: 1 };

interface Icon {
  file: string;
  size: number;
  /** Cuánto del lienzo ocupa el símbolo. */
  scale: number;
}

/**
 * Android recorta los íconos `maskable` a la forma del launcher (círculo,
 * gota, cuadrado redondeado) y solo garantiza el 80% central. Por eso esa
 * versión lleva el símbolo más chico: lo que se pierde en el recorte es fondo.
 */
const ICONS: Icon[] = [
  { file: "icon-192.png", size: 192, scale: 0.68 },
  { file: "icon-512.png", size: 512, scale: 0.68 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.5 },
  // iOS no aplica máscara pero sí redondea: mismo encuadre que los `any`.
  { file: "apple-touch-icon.png", size: 180, scale: 0.68 },
];

async function main() {
  log.title("Íconos del manifiesto");
  const svg = readFileSync(SOURCE);
  mkdirSync(OUT, { recursive: true });

  for (const { file, size, scale } of ICONS) {
    const symbol = await sharp(svg)
      .resize(Math.round(size * scale), Math.round(size * scale), {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    await sharp({ create: { width: size, height: size, channels: 4, background: SAND } })
      .composite([{ input: symbol, gravity: "center" }])
      .png()
      .toFile(join(OUT, file));

    log.ok(`${file} · ${size}×${size}`);
  }

  log.done(`${ICONS.length} íconos en ${OUT}/`);
}

void main();
