import "server-only";
import { after } from "next/server";
import { db } from "../supabase";
import { remainingFree } from "../queries";
import { paymentsEnabled } from "../payments";
import { runGenerationJob } from "../generation/pipeline";
import { dispatchToBackground, generationRunner } from "../generation/dispatch";
import { failGeneration } from "../generation/jobs";
import { CREDIT_COST_PER_MEDITATION, PLAN, type Duration } from "../config";
import { breathingSlotSeconds } from "../breathing";
import { logEvent } from "../telemetry";
import type { ScriptMode, User, Visibility } from "../types";

/**
 * Crear una meditación: la fila, el cobro, el job y el encargo al motor.
 *
 * Es lo que hacía `POST /api/meditations`, sacado de la ruta para que el MCP
 * de usuarios y el de administración generen exactamente igual que la web —
 * mismo cobro al encolar, misma devolución si falla, mismo despacho a la
 * función en segundo plano— en vez de tener tres copias que se separan.
 */

export type CreatedVia = "web" | "mcp" | "admin";

export interface NewMeditation {
  /** Texto de la intención; también es el título si no viene otro. */
  intention: string;
  intentionSlug?: string | null;
  context?: string;
  durationMinutes: Duration;
  locale: "es" | "en" | "pt";
  voiceId: string;
  breathingExerciseId?: string | null;
  /** Música horneada en el audio. Null: el reproductor la pone en vivo. */
  musicTrackId?: string | null;
  visibility: Visibility;
  title?: string | null;
  scriptMode?: ScriptMode | null;
  scriptOverride?: string | null;
  /** Duración estimada en segundos, cuando no sale de `durationMinutes` (guion completo). */
  estimatedSeconds?: number | null;
  /** 'curated' es el catálogo del equipo: sin dueño. */
  source?: "user" | "curated";
}

export type CreateResult =
  | { ok: true; id: string; charged: "free" | "credit" | "none" }
  | { ok: false; code: "out_of_credits" | "create_failed"; message: string };

export async function createMeditation(input: {
  /** Dueño. Null solo para el catálogo (lo crea el admin). */
  user: User | null;
  meditation: NewMeditation;
  /** De dónde sale la URL de la función en segundo plano. */
  origin: string;
  via: CreatedVia;
  /** Si se descuenta cupo o crédito. El admin generando para alguien puede no cobrar. */
  charge?: boolean;
}): Promise<CreateResult> {
  const { user, meditation: m, via } = input;

  // Pro no descuenta nada; Free gasta primero el cupo del mes y después
  // créditos. Sin pagos configurados no se descuenta nada a nadie.
  const billing = paymentsEnabled() && !!user && (input.charge ?? true);
  const free = user ? remainingFree(user) : 0;
  const usesFree = billing && user!.plan !== "pro" && free > 0;
  const usesCredit = billing && user!.plan !== "pro" && !usesFree;

  if (usesCredit && user!.credits < CREDIT_COST_PER_MEDITATION) {
    return { ok: false, code: "out_of_credits", message: "No te quedan personalizaciones ni créditos." };
  }

  const intentionId = m.intentionSlug
    ? ((
        await db()
          .from("omtana_intentions")
          .select("id")
          .eq("slug", m.intentionSlug)
          .maybeSingle()
      ).data?.id ?? null)
    : null;

  const title = (m.title?.trim() || m.intention).slice(0, 90);
  const row: Record<string, unknown> = {
    user_id: user?.id ?? null,
    intention_id: intentionId,
    voice_id: m.voiceId,
    // Sin música elegida no se hornea nada: el reproductor la pone en vivo,
    // con su propio volumen, sobre la sesión ya generada.
    music_track_id: m.musicTrackId ?? null,
    breathing_exercise_id: m.breathingExerciseId ?? null,
    breathing_slot_seconds: breathingSlotSeconds(m.durationMinutes),
    title,
    intention_text: m.intention,
    context_text: m.context ?? "",
    locale: m.locale,
    duration_seconds: m.estimatedSeconds ?? m.durationMinutes * 60,
    source: m.source ?? "user",
    visibility: m.visibility,
    status: "pending",
  };
  // Las columnas nuevas solo se mandan cuando hay algo que decir: así la web
  // sigue generando aunque la migración 0008 todavía no esté aplicada.
  if (via !== "web") row.created_via = via;
  if (m.scriptMode && m.scriptOverride?.trim()) {
    row.script_mode = m.scriptMode;
    row.script_override = m.scriptOverride.trim();
  }

  const { data: created, error } = await db()
    .from("omtana_meditations")
    .insert(row)
    .select("id")
    .single();

  if (error || !created) {
    return {
      ok: false,
      code: "create_failed",
      message: `No se pudo crear la meditación: ${error?.message ?? "sin detalle"}`,
    };
  }
  const id = created.id as string;

  // Se cobra al encolar. Si la generación falla, se devuelve (ver refund.ts).
  if (usesFree) {
    await db()
      .from("omtana_users")
      .update({ free_used_period: user!.free_used_period + 1 })
      .eq("id", user!.id);
    await db().from("omtana_credit_ledger").insert({
      user_id: user!.id,
      delta: -1,
      reason: `Personalización incluida en ${PLAN.free.tag}`,
      reason_key: "free_included",
      meditation_id: id,
    });
  } else if (usesCredit) {
    await db()
      .from("omtana_users")
      .update({ credits: user!.credits - CREDIT_COST_PER_MEDITATION })
      .eq("id", user!.id);
    await db().from("omtana_credit_ledger").insert({
      user_id: user!.id,
      delta: -CREDIT_COST_PER_MEDITATION,
      reason: title,
      reason_key: "meditation",
      reason_meta: { title },
      meditation_id: id,
    });
  }

  const charged = usesFree ? "free" : usesCredit ? "credit" : "none";
  if (via !== "web") {
    await logEvent({
      source: `api:${via}`,
      message: "meditación encargada",
      data: { charged, script_mode: m.scriptMode ?? null, music: !!m.musicTrackId },
      trace: { meditationId: id, userId: user?.id ?? null, via },
    });
  }

  await enqueueGeneration(id, input.origin);
  return { ok: true, id, charged };
}

/**
 * Crea el job y se lo pasa al motor: a la función en segundo plano en Netlify,
 * o al mismo proceso en local. Lo usan la creación y el reintento del admin.
 */
export async function enqueueGeneration(id: string, origin: string): Promise<{ jobId: string | null }> {
  const { data: job, error: jobError } = await db()
    .from("omtana_generation_jobs")
    .insert({ meditation_id: id, status: "queued" })
    .select("id")
    .single();

  if (!job) {
    // Sin job nadie la iba a generar y la sesión quedaba "pendiente" para
    // siempre, con lo cobrado adentro. Fallida, se devuelve lo cobrado.
    await failGeneration({
      meditationId: id,
      jobId: null,
      error: `No se pudo crear el job de generación: ${jobError?.message ?? "sin detalle"}`,
    });
    return { jobId: null };
  }

  if (generationRunner() === "background") {
    // Producción: una función en segundo plano con 15 minutos y ffmpeg. Acá
    // solo se encarga; quien espera consulta el estado mientras tanto.
    const sent = await dispatchToBackground({ origin, meditationId: id, jobId: job.id });
    if (!sent.ok) {
      await failGeneration({ meditationId: id, jobId: job.id, error: sent.reason });
    }
  } else {
    // Local: en el mismo proceso, después de responder.
    after(async () => {
      try {
        await runGenerationJob(id, job.id);
      } catch (err) {
        console.error(`[omtana] generación ${id} falló:`, err);
      }
    });
  }
  return { jobId: job.id as string };
}
