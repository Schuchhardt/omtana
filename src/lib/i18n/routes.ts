/**
 * Rutas públicas por idioma.
 *
 * Las páginas que un buscador tiene que poder ver en los dos idiomas llevan el
 * idioma en la URL: el español vive en la raíz (`/voces`) y el inglés bajo
 * `/en` con slugs propios (`/en/voices`). La cookie sirve para recordar la
 * elección de una persona, pero un crawler no la manda: sin URL propia, la
 * versión en inglés no existía para Google ni para los motores de respuesta.
 *
 * Las páginas de la cuenta (inicio, biblioteca, perfil…) no se indexan, así que
 * siguen con una sola URL y el idioma de la cookie.
 *
 * Este módulo es datos puros y no importa los diccionarios: lo usa `proxy.ts`,
 * que tiene que ser liviano.
 */

export type RouteLang = "es" | "en";

export const LANG_COOKIE = "omtana_lang";

/** Cabecera que `proxy.ts` pone en la petición con el idioma de la URL. */
export const LANG_HEADER = "x-omtana-lang";
/** Ruta interna (la española), con su query, de la página pública pedida. */
export const PATH_HEADER = "x-omtana-path";

export const EN_PREFIX = "/en";

/** Ruta interna → ruta pública en inglés. La interna es también la española. */
export const PUBLIC_ROUTES = {
  "/": "/en",
  "/voces": "/en/voices",
  "/catalogo": "/en/catalog",
  "/terminos": "/en/terms",
  "/acceso": "/en/sign-in",
} as const;

export type PublicPath = keyof typeof PUBLIC_ROUTES;

const FROM_EN = new Map<string, PublicPath>(
  Object.entries(PUBLIC_ROUTES).map(([internal, en]) => [en, internal as PublicPath]),
);

export function isPublicPath(pathname: string): pathname is PublicPath {
  return pathname in PUBLIC_ROUTES;
}

/** `/en/voices` → `/voces`. `null` si no es una ruta pública en inglés. */
export function internalFromEnglish(pathname: string): PublicPath | null {
  return FROM_EN.get(pathname) ?? null;
}

/**
 * Enlace a una ruta en el idioma pedido. Solo cambia las rutas públicas; el
 * resto se devuelve tal cual. Respeta la query y el ancla:
 * `localePath("en", "/acceso?modo=crear")` → `/en/sign-in?modo=crear`.
 */
export function localePath(lang: RouteLang, href: string): string {
  if (lang === "es" || !href.startsWith("/") || href.startsWith("//")) return href;

  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const rest = cut === -1 ? "" : href.slice(cut);

  return isPublicPath(path) ? PUBLIC_ROUTES[path] + rest : href;
}
