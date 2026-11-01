import { registerBundledFfmpeg } from "../lib/ffmpeg";
import { formatHealth, generationHealth, type HealthReport } from "../../src/lib/generation/health";
import { notifyAdmin } from "../../src/lib/alerts";

/**
 * ¿Puede producción generar? Corre la misma prueba que los tests —ffmpeg
 * presente, una mezcla de verdad, variables cargadas— dentro del entorno
 * desplegado, con la misma configuración de empaquetado que generate-background.
 *
 * - `GET /.netlify/functions/generation-health` devuelve el informe (200 o 503).
 *   Sirve para mirarlo a mano o colgarle un monitor de uptime.
 * - Después de cada deploy exitoso corre sola y, si algo falla, avisa al equipo
 *   antes de que lo descubra alguien intentando generar.
 */

registerBundledFfmpeg();

/** Un minuto de caché por instancia: la prueba mezcla audio de verdad. */
let cached: { at: number; report: HealthReport } | null = null;

async function report(): Promise<HealthReport> {
  if (cached && Date.now() - cached.at < 60_000) return cached.report;
  const fresh = await generationHealth();
  cached = { at: Date.now(), report: fresh };
  return fresh;
}

const healthFunction = {
  async fetch(): Promise<Response> {
    const result = await report();
    return Response.json(result, {
      status: result.ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  },

  async deploySucceeded(): Promise<void> {
    cached = null;
    const result = await report();
    if (result.ok) {
      console.log(`[omtana] deploy listo para generar:\n${formatHealth(result)}`);
      return;
    }
    await notifyAdmin({
      title: "El deploy nuevo no puede generar meditaciones",
      detail: formatHealth(result),
      fields: { revisar: "/.netlify/functions/generation-health" },
    });
  },
};

export default healthFunction;
