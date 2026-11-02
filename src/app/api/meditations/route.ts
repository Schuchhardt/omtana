import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { createMeditation } from "@/lib/meditations/create";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";

// Solo pesa en local (`inline`): en Netlify la generación no corre en esta
// función, que se corta a los 60 s, sino en generate-background.
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

  // El cobro, el job y el despacho viven en lib/meditations/create.ts: los
  // comparte con los MCP para que generen igual que la web.
  const result = await createMeditation({
    user,
    origin: new URL(request.url).origin,
    via: "web",
    meditation: {
      intention: input.intention,
      intentionSlug: input.intentionSlug,
      context: input.context,
      durationMinutes: input.durationMinutes,
      locale: input.locale,
      voiceId: input.voiceId,
      breathingExerciseId: input.breathingExerciseId,
      visibility: input.visibility,
    },
  });

  if (!result.ok) {
    return result.code === "out_of_credits"
      ? NextResponse.json({ error: t.outOfCredits }, { status: 402 })
      : NextResponse.json({ error: t.meditationCreateFailed }, { status: 500 });
  }

  return NextResponse.json({ id: result.id }, { status: 201 });
}
