import { NextResponse, type NextRequest } from "next/server";
import {
  EN_PREFIX,
  LANG_COOKIE,
  LANG_HEADER,
  PATH_HEADER,
  PUBLIC_ROUTES,
  internalFromEnglish,
  isPublicPath,
} from "@/lib/i18n/routes";

/**
 * Idioma en la URL para las páginas públicas (ver `lib/i18n/routes.ts`).
 *
 * - `/en/...` se reescribe a la ruta interna y la petición sale con el idioma
 *   en una cabecera, que es lo primero que mira `getLang()`.
 * - La ruta española de una página pública manda a su versión en inglés solo a
 *   quien ya eligió inglés (cookie) o, si todavía no eligió, a un navegador que
 *   pide inglés primero. Los bots nunca se redirigen: tienen que poder leer
 *   las dos versiones, y varios motores de respuesta mandan `Accept-Language:
 *   en` aunque estén indexando la española.
 * - El resto de las rutas pasa sin tocar y sigue con el idioma de la cookie.
 */

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|lighthouse|headless|gptbot|claude|perplexity|chatgpt|bingpreview/i;

function forward(request: NextRequest, lang: "es" | "en" | null, internal: string | null, url?: URL) {
  const headers = new Headers(request.headers);
  // Nunca se confía en lo que traiga la petición: estas cabeceras son nuestras.
  headers.delete(LANG_HEADER);
  headers.delete(PATH_HEADER);
  if (lang) headers.set(LANG_HEADER, lang);
  if (internal) headers.set(PATH_HEADER, internal);

  return url
    ? NextResponse.rewrite(url, { request: { headers } })
    : NextResponse.next({ request: { headers } });
}

function prefersEnglish(request: NextRequest): boolean {
  const chosen = request.cookies.get(LANG_COOKIE)?.value;
  if (chosen) return chosen === "en";

  if (BOT.test(request.headers.get("user-agent") ?? "")) return false;
  const first = request.headers.get("accept-language")?.split(",")[0]?.trim().slice(0, 2);
  return first?.toLowerCase() === "en";
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isRead = request.method === "GET" || request.method === "HEAD";

  if (pathname === EN_PREFIX || pathname.startsWith(`${EN_PREFIX}/`)) {
    const internal = internalFromEnglish(pathname);
    if (internal) {
      const url = request.nextUrl.clone();
      url.pathname = internal;
      return forward(request, "en", internal + search, url);
    }

    // `/en/voces` o `/en/home`: la ruta española con prefijo, o una página de
    // la cuenta, que no tiene versión en inglés propia.
    const rest = pathname.slice(EN_PREFIX.length) || "/";
    const target = isPublicPath(rest) ? PUBLIC_ROUTES[rest] : rest;
    return NextResponse.redirect(new URL(target + search, request.url), 308);
  }

  if (isPublicPath(pathname)) {
    if (isRead && prefersEnglish(request)) {
      const response = NextResponse.redirect(new URL(PUBLIC_ROUTES[pathname] + search, request.url));
      // La respuesta depende de estas dos cabeceras: ninguna caché intermedia
      // debería servirle esta redirección a otra persona.
      response.headers.set("Vary", "Cookie, Accept-Language");
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    return forward(request, "es", pathname + search);
  }

  return forward(request, null, null);
}

export const config = {
  // Fuera: la API, los archivos de Next y todo lo que tenga extensión
  // (imágenes, `sw.js`, `robots.txt`, `sitemap.xml`, `llms.txt`…).
  matcher: ["/((?!api/|_next/|.*\\.[a-zA-Z0-9]+$).*)"],
};
