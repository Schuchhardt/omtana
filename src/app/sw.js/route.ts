import { BUILD_ID } from "@/lib/version";

/**
 * Service worker, servido desde la raíz para que su alcance sea todo el sitio.
 *
 * Es una ruta y no un archivo en `public/` porque el worker necesita saber de
 * qué build es: ese identificador nombra el cache y es lo que hace que un
 * deploy nuevo invalide el anterior. Como `BUILD_ID` se inyecta al compilar, la
 * ruta se genera estática y la sirve el CDN; las cabeceras de `/sw.js` están en
 * `next.config.ts` para que el navegador revalide siempre y nunca se quede
 * pegado con un worker viejo.
 */
export const dynamic = "force-static";

const source = (version: string) => `
/* Omtana · build ${version} — generado por src/app/sw.js/route.ts */
const VERSION = ${JSON.stringify(version)};
const CACHE = "omtana-" + VERSION;

/* Lo mínimo para que una pestaña sin red muestre algo nuestro. */
const PRECACHE = ["/offline", "/icons/icon-192.png", "/brand/omtana-wordmark-black.svg"];

/* Assets con hash en el nombre o activos de marca: no cambian sin cambiar de URL. */
const IMMUTABLE = /^\\/(?:_next\\/static|icons|brand)\\//;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      /* Uno a uno y no con addAll: si falta un recurso el worker igual se instala. */
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))),
    ),
  );
  /* Sin skipWaiting acá: quien decide cuándo entra el build nuevo es la página,
     que espera a que no haya una meditación sonando. Ver ServiceWorkerBridge. */
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      /* Cache versionado: al activarse este build se borra todo lo que quedó de
         los anteriores, así nadie arrastra assets de un deploy viejo. */
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("omtana-") && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "omtana:skip-waiting") self.skipWaiting();
  if (event.data === "omtana:version") event.source?.postMessage({ version: VERSION });
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  /* Solo lo nuestro: el audio llega por URL firmada de Supabase, que es otro origen. */
  if (url.origin !== self.location.origin) return;
  /* El <audio> pide rangos y una respuesta completa desde cache rompe el avance. */
  if (request.headers.has("range")) return;
  /* API y peticiones RSC llevan datos de la sesión: nunca pasan por cache. */
  if (url.pathname.startsWith("/api/")) return;
  if (url.searchParams.has("_rsc")) return;

  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(fromCacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fromNetworkOrOffline(request));
  }
});

async function fromCacheFirst(request) {
  const cached = await caches.match(request, { cacheName: CACHE });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function fromNetworkOrOffline(request) {
  try {
    /* Siempre a la red primero. El HTML es lo que trae el build nuevo, así que
       servirlo desde cache sería justo lo que impide ver el último deploy.
       Tampoco se guarda: las páginas con sesión traen datos de la cuenta. */
    return await fetch(request);
  } catch {
    const offline = await caches.match("/offline", { cacheName: CACHE });
    return offline ?? Response.error();
  }
}
`.trimStart();

export function GET() {
  return new Response(source(BUILD_ID), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "service-worker-allowed": "/",
    },
  });
}
