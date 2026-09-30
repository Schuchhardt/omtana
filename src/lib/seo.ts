import "server-only";
import type { Metadata } from "next";
import { PUBLIC_ROUTES, localePath, type PublicPath } from "./i18n/routes";
import { copy, type UiLang } from "./i18n";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export const OG_LOCALE: Record<UiLang, string> = { es: "es_ES", en: "en_US" };

/** Imagen para compartir de cada idioma. Se genera con `npm run og`. */
export function ogImage(lang: UiLang) {
  return {
    url: `/og/omtana-${lang}.png`,
    width: 1200,
    height: 630,
    alt: copy(lang).og.alt,
    type: "image/png",
  };
}

export function absoluteUrl(path: string): string {
  return SITE_URL + path;
}

/**
 * `hreflang` de una página pública: las dos versiones más `x-default`, que es
 * la española (la raíz, el idioma de origen del producto).
 */
export function languageAlternates(path: PublicPath) {
  return {
    es: absoluteUrl(path),
    en: absoluteUrl(PUBLIC_ROUTES[path]),
    "x-default": absoluteUrl(path),
  };
}

/**
 * Metadatos de una página pública en el idioma pedido: canonical propio,
 * alternativas por idioma y la tarjeta para redes con la URL correcta.
 *
 * `title` como texto pasa por la plantilla del layout (`%s · Omtana`); la
 * portada lo pasa como `{ absolute }` para no repetir la marca.
 */
export function publicMetadata(
  lang: UiLang,
  path: PublicPath,
  { title, description }: { title: string | { absolute: string }; description: string },
): Metadata {
  const url = absoluteUrl(localePath(lang, path));
  const fullTitle = typeof title === "string" ? `${title} · Omtana` : title.absolute;
  return {
    title,
    description,
    alternates: { canonical: url, languages: languageAlternates(path) },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: "Omtana",
      type: "website",
      locale: OG_LOCALE[lang],
      alternateLocale: OG_LOCALE[lang === "es" ? "en" : "es"],
      images: [ogImage(lang)],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [ogImage(lang)] },
  };
}

/** Las páginas de la cuenta no tienen nada que buscar en un índice. */
export const PRIVATE_ROBOTS: Metadata["robots"] = { index: false, follow: false };

/** `<script type="application/ld+json">` sin dejar pasar `</script>`. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
