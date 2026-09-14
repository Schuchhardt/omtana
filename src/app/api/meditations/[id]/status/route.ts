import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { signedUrl } from "@/lib/storage";
import { getLang } from "@/lib/lang";
import { copy, type Copy } from "@/lib/i18n";
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

  const { data: job } = await db()
    .from("omtana_generation_jobs")
    .select("step, error, status")
    .eq("meditation_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Una generación fallida devuelve lo cobrado, una sola vez.
  if (meditation.status === "failed" && mine && user) {
    const { data: refunded } = await db()
      .from("omtana_credit_ledger")
      .select("id")
      .eq("meditation_id", id)
      .gt("delta", 0)
      .maybeSingle();

    if (!refunded) {
      await db().from("omtana_credit_ledger").insert({
        user_id: user.id,
        delta: 1,
        reason: "Devolución por generación fallida",
        reason_key: "refund_failed",
        meditation_id: id,
      });
      await db()
        .from("omtana_users")
        .update({ credits: user.credits + 1 })
        .eq("id", user.id);
    }
  }

  return NextResponse.json({
    status: meditation.status,
    title: meditation.title,
    step: job?.step ? label(t.steps, job.step) : null,
    error: meditation.status === "failed" ? (job?.error ?? t.failedFallback) : null,
    durationSeconds: meditation.duration_seconds,
    audioUrl: meditation.status === "ready" ? await signedUrl(meditation.audio_path) : null,
  });
}
