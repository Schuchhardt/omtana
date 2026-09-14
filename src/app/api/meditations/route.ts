import { NextResponse, after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { remainingFree } from "@/lib/queries";
import { runGenerationJob } from "@/lib/generation/pipeline";
import { CREDIT_COST_PER_MEDITATION, PLAN } from "@/lib/config";
import { breathingSlotSeconds } from "@/lib/breathing";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";

export const maxDuration = 300;

const schema = z.object({
  intention: z.string().trim().min(3).max(160),
  intentionSlug: z.string().trim().max(80).nullable().optional(),
  context: z.string().trim().max(600).default(""),
  durationMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
  locale: z.enum(["es", "en", "pt"]),
  voiceId: z.string().uuid(),
  breathingExerciseId: z.string().uuid().nullable().optional(),
  visibility: z.enum(["private", "public"]),
});

export async function POST(request: Request) {
  const t = copy(await getLang()).api;
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: t.signInRequired }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: t.missingMeditationData },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Pro no descuenta nada; Free gasta primero el cupo del mes y después créditos.
  const free = remainingFree(user);
  const usesFree = user.plan !== "pro" && free > 0;
  const usesCredit = user.plan !== "pro" && !usesFree;

  if (usesCredit && user.credits < CREDIT_COST_PER_MEDITATION) {
    return NextResponse.json(
      { error: t.outOfCredits },
      { status: 402 },
    );
  }

  const intentionId = input.intentionSlug
    ? ((
        await db()
          .from("omtana_intentions")
          .select("id")
          .eq("slug", input.intentionSlug)
          .maybeSingle()
      ).data?.id ?? null)
    : null;

  const { data: meditation, error } = await db()
    .from("omtana_meditations")
    .insert({
      user_id: user.id,
      intention_id: intentionId,
      voice_id: input.voiceId,
      // La música ya no se mezcla dentro del audio: el reproductor la pone en
      // vivo, con su propio volumen, sobre la sesión ya generada.
      music_track_id: null,
      breathing_exercise_id: input.breathingExerciseId ?? null,
      breathing_slot_seconds: breathingSlotSeconds(input.durationMinutes),
      title: input.intention.slice(0, 90),
      intention_text: input.intention,
      context_text: input.context,
      locale: input.locale,
      duration_seconds: input.durationMinutes * 60,
      source: "user",
      visibility: input.visibility,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !meditation) {
    return NextResponse.json({ error: t.meditationCreateFailed }, { status: 500 });
  }

  // Se cobra al encolar. Si la generación falla, /status devuelve el crédito.
  if (usesFree) {
    await db()
      .from("omtana_users")
      .update({ free_used_period: user.free_used_period + 1 })
      .eq("id", user.id);
    await db().from("omtana_credit_ledger").insert({
      user_id: user.id,
      delta: -1,
      reason: `Personalización incluida en ${PLAN.free.tag}`,
      reason_key: "free_included",
      meditation_id: meditation.id,
    });
  } else if (usesCredit) {
    await db()
      .from("omtana_users")
      .update({ credits: user.credits - CREDIT_COST_PER_MEDITATION })
      .eq("id", user.id);
    await db().from("omtana_credit_ledger").insert({
      user_id: user.id,
      delta: -CREDIT_COST_PER_MEDITATION,
      reason: input.intention.slice(0, 90),
      reason_key: "meditation",
      reason_meta: { title: input.intention.slice(0, 90) },
      meditation_id: meditation.id,
    });
  }

  const { data: job } = await db()
    .from("omtana_generation_jobs")
    .insert({ meditation_id: meditation.id, status: "queued" })
    .select("id")
    .single();

  // La respuesta sale de inmediato; el reproductor consulta /status mientras tanto.
  after(async () => {
    if (!job) return;
    try {
      await runGenerationJob(meditation.id, job.id);
    } catch (err) {
      console.error(`[omtana] generación ${meditation.id} falló:`, err);
    }
  });

  return NextResponse.json({ id: meditation.id }, { status: 201 });
}
