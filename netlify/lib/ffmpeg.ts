import { createRequire } from "node:module";
import { registerFfmpegCandidate } from "../../src/lib/generation/audio";

/**
 * Le dice al motor dónde quedó el ffmpeg de `ffmpeg-static` dentro de la
 * función ya desplegada.
 *
 * netlify.toml deja `ffmpeg-static` fuera del bundle (`external_node_modules`)
 * y suma el binario con `included_files`. Así el paquete se resuelve en
 * runtime y su `__dirname` apunta al binario de verdad; si se empaquetara
 * adentro, `__dirname` sería el del bundle y la ruta no existiría.
 *
 * Si algo de eso falla, el motor igual busca en `node_modules/ffmpeg-static`
 * desde la raíz de la función (`LAMBDA_TASK_ROOT`), y si tampoco está, el
 * error dice qué rutas se probaron.
 */
export function registerBundledFfmpeg(): void {
  try {
    const path = createRequire(import.meta.url)("ffmpeg-static") as string | null;
    registerFfmpegCandidate(path);
  } catch {
    // Sin el paquete quedan los otros candidatos; el error, si llega, los lista.
  }
}
