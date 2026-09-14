import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";

const schema = z.object({
  secondsListened: z.number().int().min(0).max(60 * 60),
  completed: z.boolean(),
});

/** Registra una escucha. Es el dato que después alimenta "Continuar" y el perfil. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const t = copy(await getLang()).api;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t.invalidValue }, { status: 400 });

  const user = await currentUser();

  const { data: meditation } = await db()
    .from("omtana_meditations")
    .select("id, user_id, visibility, plays")
    .eq("id", id)
    .maybeSingle();

  if (!meditation) return NextResponse.json({ error: t.notFound }, { status: 404 });
  if (meditation.visibility !== "public" && meditation.user_id !== user?.id) {
    return NextResponse.json({ error: t.notFound }, { status: 404 });
  }

  await db().from("omtana_plays").insert({
    meditation_id: id,
    user_id: user?.id ?? null,
    seconds_listened: parsed.data.secondsListened,
    completed: parsed.data.completed,
  });

  if (parsed.data.completed) {
    await db()
      .from("omtana_meditations")
      .update({ plays: meditation.plays + 1 })
      .eq("id", id);
  }

  return NextResponse.json({ ok: true });
}
