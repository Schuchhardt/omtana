/**
 * Genera las imágenes para compartir (Open Graph / Twitter), una por idioma.
 *
 *   npm run og
 *
 * Como los íconos, se corre a mano cuando cambia la marca o el titular, y los
 * PNG viven en el repo (`public/og/`): así el build no depende de bajar la
 * tipografía ni de renderizar nada.
 */
import { log } from "./_bootstrap";
import { ImageResponse } from "next/og";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { barHeights } from "../src/components/Wave";
import { copy, UI_LANGS } from "../src/lib/i18n";

const OUT = "public/og";
const OG_SIZE = { width: 1200, height: 630 };

// Jost, la tipografía del sitio, en TTF: satori no lee woff2.
const FONTS = {
  300: "https://fonts.gstatic.com/s/jost/v20/92zPtBhPNqw79Ij1E865zBUv7mz9JQVG.ttf",
  400: "https://fonts.gstatic.com/s/jost/v20/92zPtBhPNqw79Ij1E865zBUv7myjJQVG.ttf",
} as const;

const SAND = "#f6f1e9";
const INK = "#241f1a";
const CLAY = "#b4643c";
const CLAY_BAR = "#d5c4b2";

function svgDataUri(file: string): string {
  return `data:image/svg+xml;base64,${readFileSync(join("public/brand", file)).toString("base64")}`;
}

async function main() {
  log.title("Imágenes para compartir");
  mkdirSync(OUT, { recursive: true });

  const fonts = await Promise.all(
    Object.entries(FONTS).map(async ([weight, url]) => ({
      name: "Jost",
      weight: Number(weight) as 300 | 400,
      style: "normal" as const,
      data: await fetch(url).then((r) => r.arrayBuffer()),
    })),
  );

  const symbol = svgDataUri("omtana-symbol-black.svg");
  const wordmark = svgDataUri("omtana-wordmark-black.svg");
  const bars = barHeights(64, 96);

  for (const lang of UI_LANGS) {
    const t = copy(lang);

    const image = new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            background: SAND,
            padding: "72px 80px 64px",
            fontFamily: "Jost",
            color: INK,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={symbol} width={44} height={44} alt="" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={wordmark} width={170} height={28} alt="" />
          </div>

          <div
            style={{
              marginTop: 64,
              fontSize: 22,
              fontWeight: 400,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: CLAY,
            }}
          >
            {t.og.eyebrow}
          </div>

          <div
            style={{
              marginTop: 20,
              fontSize: 60,
              fontWeight: 300,
              lineHeight: 1.12,
              letterSpacing: -1,
              maxWidth: 960,
            }}
          >
            {t.hero.title}
          </div>

          <div
            style={{
              marginTop: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 96,
            }}
          >
            {bars.map((h, i) => (
              <div
                key={i}
                style={{ flex: 1, height: Math.round(h), borderRadius: 3, background: CLAY_BAR }}
              />
            ))}
          </div>
        </div>
      ),
      { ...OG_SIZE, fonts },
    );

    const file = join(OUT, `omtana-${lang}.png`);
    writeFileSync(file, Buffer.from(await image.arrayBuffer()));
    log.ok(file);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
