import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Dónde corre la generación que pide la app.
 *
 * - `background` (producción en Netlify): la ruta crea el job y se lo pasa a
 *   `netlify/functions/generate-background`, una función en segundo plano con
 *   quince minutos de vida y ffmpeg empaquetado. Una función síncrona de
 *   Netlify se corta a los 60 s, contando lo que corre en `after()`, y escribir
 *   el guion más sintetizar la voz suele pasarse de eso.
 * - `inline` (local, `next dev`): corre en el mismo proceso con `after()`.
 *
 * Se elige con `GENERATION_RUNNER`. Si no está, `next.config.ts` deja fijado al
 * compilar `background` cuando el build corre en Netlify e `inline` en el resto.
 *
 * Sin "server-only" ni alias `@/`: lo importa también la función de Netlify.
 */
export type GenerationRunner = "background" | "inline";

export const BACKGROUND_FUNCTION_PATH = "/.netlify/functions/generate-background";
export const SIGNATURE_HEADER = "x-omtana-signature";

export function generationRunner(
  explicit: string | undefined = process.env.GENERATION_RUNNER,
  // Referencia literal para que Next la reemplace con lo fijado en next.config.ts.
  baked: string | undefined = process.env.OMTANA_GENERATION_RUNNER,
): GenerationRunner {
  const value = (explicit || baked || "").trim().toLowerCase();
  return value === "background" ? "background" : "inline";
}

/**
 * Clave con la que la app firma el encargo y la función lo verifica. Sale de
 * la service role key, que las dos ya tienen, así que no hay otro secreto que
 * cargar; `GENERATION_SECRET` la reemplaza si alguna vez hace falta rotarla
 * por separado.
 */
function signingKey(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.GENERATION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) {
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (o GENERATION_SECRET) para firmar el encargo.");
  }
  return base;
}

export function signJob(meditationId: string, jobId: string, key: string = signingKey()): string {
  return createHmac("sha256", `omtana:generation:${key}`)
    .update(`${meditationId}:${jobId}`)
    .digest("hex");
}

export function verifyJob(
  meditationId: string,
  jobId: string,
  signature: string | null | undefined,
  key?: string,
): boolean {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  let expected: string;
  try {
    expected = signJob(meditationId, jobId, key ?? signingKey());
  } catch {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}

export type DispatchResult = { ok: true } | { ok: false; reason: string };

/**
 * Le pasa el job a la función en segundo plano. Netlify contesta 202 apenas la
 * acepta, así que esto tarda lo que tarda un viaje de ida y vuelta.
 */
export async function dispatchToBackground(
  input: { origin: string; meditationId: string; jobId: string },
  deps: { fetch?: typeof fetch; key?: string } = {},
): Promise<DispatchResult> {
  const doFetch = deps.fetch ?? fetch;
  const url = new URL(BACKGROUND_FUNCTION_PATH, input.origin);

  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: signJob(input.meditationId, input.jobId, deps.key ?? signingKey()),
      },
      body: JSON.stringify({ meditationId: input.meditationId, jobId: input.jobId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 202 || res.ok) return { ok: true };
    return {
      ok: false,
      reason: `La función de generación respondió ${res.status} en ${url.pathname}.`,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `No se pudo llamar a ${url.pathname}: ${err instanceof Error ? err.message : err}`,
    };
  }
}
