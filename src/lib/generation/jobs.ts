import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "../supabase-client";
import { notifyAdmin } from "../alerts";
import { classifyGenerationError } from "./errors";

/**
 * Ciclo de vida de un job de generación, visto desde afuera del motor: quién lo
 * toma, cómo se registra una falla y qué pasa con los que nadie terminó.
 *
 * Sin "server-only" ni alias `@/`: lo usan la app, la función en segundo plano
 * y la que barre jobs colgados.
 */

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobRow {
  id: string;
  meditation_id: string;
  status: JobStatus;
  step: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
}

/**
 * Un job en cola que no arrancó en seis minutos se perdió. El despacho tarda
 * segundos; si la invocación falla, Netlify la reintenta al minuto y a los
 * tres, así que pasado eso ya no va a llegar nadie.
 */
export const QUEUED_STALE_MS = 6 * 60_000;

/**
 * Una función en segundo plano de Netlify se corta a los 15 minutos, sin
 * avisar: el job queda en "running" para siempre. Un minuto de margen.
 */
export const RUNNING_STALE_MS = 16 * 60_000;

const ACTIVE: JobStatus[] = ["queued", "running"];

interface Deps {
  client?: SupabaseClient;
  notify?: typeof notifyAdmin;
  now?: () => number;
}

export function isStale(
  job: Pick<JobRow, "status" | "created_at" | "started_at">,
  now: number = Date.now(),
): boolean {
  if (job.status === "queued") {
    return now - Date.parse(job.created_at) > QUEUED_STALE_MS;
  }
  if (job.status === "running") {
    return now - Date.parse(job.started_at ?? job.created_at) > RUNNING_STALE_MS;
  }
  return false;
}

export function staleReason(job: Pick<JobRow, "status" | "step">): string {
  return job.status === "queued"
    ? `La generación nunca arrancó: el job pasó más de ${QUEUED_STALE_MS / 60_000} minutos en cola. ` +
        `Revisa que la función generate-background esté desplegada y que el despacho no haya fallado.`
    : `La generación se cortó en el paso "${job.step ?? "?"}": pasaron más de ${RUNNING_STALE_MS / 60_000} ` +
        `minutos sin terminar. Lo más probable es que la función se haya quedado sin tiempo o sin memoria.`;
}

/**
 * Toma el job si sigue en cola. Solo uno lo consigue: Netlify reintenta las
 * funciones en segundo plano que fallan, y un reintento no puede volver a
 * pagar modelo ni voz por la misma sesión.
 */
export async function claimJob(jobId: string, deps: Deps = {}): Promise<boolean> {
  const client = deps.client ?? db();
  const { data, error } = await client
    .from("omtana_generation_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("id");

  if (error) throw new Error(`No se pudo tomar el job ${jobId}: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Marca la generación como fallida y avisa al equipo.
 *
 * Solo toca jobs que siguen activos: si ya terminaron (bien o mal) no hay nada
 * que marcar ni que avisar dos veces. La devolución del crédito la hace
 * `/status` cuando ve la sesión fallida, igual que antes.
 *
 * No lanza: se llama justo cuando algo ya salió mal, y lo que importa es que
 * quede registrado y que el aviso salga.
 */
export async function failGeneration(
  input: { meditationId: string; jobId: string | null; error: unknown },
  deps: Deps = {},
): Promise<boolean> {
  const client = deps.client ?? db();
  const notify = deps.notify ?? notifyAdmin;
  const message =
    input.error instanceof Error ? input.error.message : String(input.error ?? "Error desconocido");
  const problems: string[] = [];

  let step: string | null = null;
  if (input.jobId) {
    try {
      const { data, error } = await client
        .from("omtana_generation_jobs")
        .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
        .eq("id", input.jobId)
        .in("status", ACTIVE)
        .select("step");
      if (error) throw new Error(error.message);
      // Ya estaba cerrado: alguien llegó antes (el reintento, el barrido o el propio motor).
      if (!data?.length) return false;
      step = (data[0] as { step: string | null }).step;
    } catch (err) {
      problems.push(`No se pudo marcar el job: ${err instanceof Error ? err.message : err}`);
    }
  }

  let meditation: { duration_seconds?: number; locale?: string; source?: string } | null = null;
  try {
    const { data, error } = await client
      .from("omtana_meditations")
      .update({ status: "failed" })
      .eq("id", input.meditationId)
      .select("duration_seconds, locale, source")
      .maybeSingle();
    if (error) throw new Error(error.message);
    meditation = data;
  } catch (err) {
    problems.push(`No se pudo marcar la meditación: ${err instanceof Error ? err.message : err}`);
  }

  const kind = classifyGenerationError(message);
  await notify({
    title:
      kind === "refused"
        ? "El modelo se negó a escribir un guion"
        : "Falló la generación de una meditación",
    detail: [message, ...problems].join("\n"),
    fields: {
      meditación: input.meditationId,
      job: input.jobId,
      paso: step,
      duración: meditation?.duration_seconds ? `${Math.round(meditation.duration_seconds / 60)} min` : null,
      idioma: meditation?.locale,
      origen: meditation?.source,
    },
  });

  return true;
}

/**
 * Barre los jobs que se quedaron colgados y los da por fallidos (con aviso).
 * Lo corre la función programada de Netlify y, para una sola sesión, `/status`
 * cuando alguien la está esperando.
 */
export async function reapStaleJobs(deps: Deps = {}): Promise<JobRow[]> {
  const client = deps.client ?? db();
  const now = (deps.now ?? Date.now)();
  // Ningún job activo más nuevo que esto puede estar colgado.
  const cutoff = new Date(now - Math.min(QUEUED_STALE_MS, RUNNING_STALE_MS)).toISOString();

  const { data, error } = await client
    .from("omtana_generation_jobs")
    .select("id, meditation_id, status, step, error, created_at, started_at")
    .in("status", ACTIVE)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) throw new Error(`No se pudieron leer los jobs: ${error.message}`);

  const reaped: JobRow[] = [];
  for (const job of (data ?? []) as JobRow[]) {
    if (!isStale(job, now)) continue;
    const failed = await failGeneration(
      { meditationId: job.meditation_id, jobId: job.id, error: staleReason(job) },
      deps,
    );
    if (failed) reaped.push(job);
  }
  return reaped;
}
