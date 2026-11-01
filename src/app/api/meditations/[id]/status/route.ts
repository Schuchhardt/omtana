import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { signedUrl } from "@/lib/storage";
import { refundFailedGeneration } from "@/lib/meditations/refund";
import { getLang } from "@/lib/lang";
import { copy, type Copy } from "@/lib/i18n";
import { classifyGenerationError } from "@/lib/generation/errors";
import { failGeneration, isStale, staleReason, type JobRow } from "@/lib/generation/jobs";
import type { Meditation } from "@/lib/types";

/**
 * El paso viene del job con una clave estable en la base; el rótulo que ve la
 * persona se arma acá, en su idioma.
 */
function label(steps: Copy["player"]["steps"], step: string): string {
  if (step.startsWith("voz:") || step.startsWith("plantilla:voz:")) return steps.voz;
  return steps[step] ?? steps.fallback;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await currentUser();
  const lang = await getLang();
  const t = copy(lang).player;
  const api = copy(lang).api;

  const { data } = await db()
    .from("omtana_meditations")
    .select("id, user_id, visibility, status, audio_path, duration_seconds, title")
    .eq("id", id)
    .maybeSingle();

  const meditation = data as Pick<
    Meditation,
    "id" | "user_id" | "visibility" | "status" | "audio_path" | "duration_seconds" | "title"
  > | null;

  if (!meditation) return NextResponse.json({ error: api.notFound }, { status: 404 });

  const mine = !!user && meditation.user_id === user.id;
  if (!mine && meditation.visibility !== "public") {
    return NextResponse.json({ error: api.notFound }, { status: 404 });
  }

  const { data: latestJob } = await db()
    .from("omtana_generation_jobs")
    .select("id, meditation_id, step, error, status, created_at, started_at")
    .eq("meditation_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let job = latestJob as JobRow | null;

  // Un job que nadie va a terminar (la función se cortó, el encargo se perdió)
  // se da por fallido acá, con aviso al equipo, para que la persona no se
  // quede mirando "Generando" para siempre y recupere lo cobrado.
  if (job && isStale(job)) {
    const reason = staleReason(job);
    if (await failGeneration({ meditationId: id, jobId: job.id, error: reason })) {
      meditation.status = "failed";
      job = { ...job, status: "failed", error: reason };
    }
  }

  // Una generación fallida devuelve lo cobrado, una sola vez (lib/meditations/
  // refund.ts, que comparte con el MCP). Sin pagos no se cobró nada al
  // encolar, así que tampoco hay nada que devolver.
  if (meditation.status === "failed" && mine) {
    await refundFailedGeneration(id);
  }

  return NextResponse.json({
    status: meditation.status,
    title: meditation.title,
    step: job?.step ? label(t.steps, job.step) : null,
    // El detalle técnico va al aviso del equipo; acá, lo que le sirve a quien espera.
    error:
      meditation.status === "failed"
        ? classifyGenerationError(job?.error) === "refused"
          ? t.failedRefused
          : t.failedInternal
        : null,
    durationSeconds: meditation.duration_seconds,
    audioUrl: meditation.status === "ready" ? await signedUrl(meditation.audio_path) : null,
  });
}
