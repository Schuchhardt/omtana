import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, type PublicPath } from "@/lib/i18n/routes";
import { absoluteUrl, languageAlternates } from "@/lib/seo";

/**
 * Las páginas públicas en los dos idiomas, cada una con su par en `hreflang`.
 * Las de la cuenta no van: no se indexan.
 */
const PRIORITY: Record<PublicPath, number> = {
  "/": 1,
  "/catalogo": 0.8,
  "/voces": 0.7,
  "/acceso": 0.4,
  "/terminos": 0.2,
};

export default function sitemap(): MetadataRoute.Sitemap {
  return (Object.keys(PUBLIC_ROUTES) as PublicPath[]).flatMap((path) => {
    const alternates = { languages: languageAlternates(path) };
    return [path, PUBLIC_ROUTES[path]].map((url) => ({
      url: absoluteUrl(url),
      changeFrequency: path === "/catalogo" ? ("weekly" as const) : ("monthly" as const),
      priority: PRIORITY[path],
      alternates,
    }));
  });
}
