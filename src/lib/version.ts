/**
 * Identidad del build que está corriendo.
 *
 * Los valores los inyecta `next.config.ts` al compilar, así que son constantes
 * en el bundle: sirven igual en servidor y en cliente, y no hay que exponer
 * nada en tiempo de ejecución. En Netlify el hash viene de `COMMIT_REF`; en
 * local, de `git rev-parse`.
 *
 * `BUILD_ID` es además el número de versión del cache del service worker
 * (`src/app/sw.js/route.ts`): cambia con cada deploy y eso es lo que fuerza a
 * los navegadores a soltar lo que guardaron del build anterior.
 */

/** Versión del paquete: `0.1.0`. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

/** Hash corto del commit desplegado, o `dev` si se compiló fuera de un repo. */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/** Lo que se muestra en el pie: `v0.1.0 · 0262639`. */
export const VERSION_LABEL = `v${APP_VERSION} · ${BUILD_ID}`;
