import { registerBundledFfmpeg } from "../lib/ffmpeg";
import { runGenerationJob } from "../../src/lib/generation/pipeline";
import { SIGNATURE_HEADER, verifyJob } from "../../src/lib/generation/dispatch";

/**
 * Genera una meditación pedida desde la app, en segundo plano.
 *
 * La ruta `POST /api/meditations` crea la sesión y el job, y llama acá con el
 * encargo firmado. Netlify responde 202 de inmediato y esta función sigue
 * hasta 15 minutos —una síncrona se corta a los 60 s, y escribir el guion y
 * sintetizar la voz suele pasarse de eso—, con ffmpeg empaquetado (ver
 * netlify.toml).
 *
 * Nunca lanza: si una invocación falla, Netlify la reintenta, y el reintento
 * volvería a pagar modelo y voz. La falla queda registrada en el job y sale el
 * aviso al equipo (`failGeneration`); además `claimJob` hace que un mismo job
 * corra una sola vez aunque llegue dos veces.
 */

registerBundledFfmpeg();

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Método no permitido", { status: 405 });

  const body = (await req.json().catch(() => null)) as {
    meditationId?: unknown;
    jobId?: unknown;
  } | null;
  const meditationId = typeof body?.meditationId === "string" ? body.meditationId : null;
  const jobId = typeof body?.jobId === "string" ? body.jobId : null;
  if (!meditationId || !jobId) return new Response("Encargo incompleto", { status: 400 });

  if (!verifyJob(meditationId, jobId, req.headers.get(SIGNATURE_HEADER))) {
    return new Response("Firma inválida", { status: 401 });
  }

  try {
    const outcome = await runGenerationJob(meditationId, jobId);
    console.log(`[omtana] generación ${meditationId}: ${outcome}`);
    return new Response(outcome);
  } catch (err) {
    // runGenerationJob ya marcó la falla y avisó.
    console.error(`[omtana] generación ${meditationId} falló:`, err);
    return new Response("failed");
  }
}

export const config = {
  background: true,
};
