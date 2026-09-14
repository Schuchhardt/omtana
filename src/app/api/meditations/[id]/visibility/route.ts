import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";

const schema = z.object({ visibility: z.enum(["private", "public"]) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const t = copy(await getLang()).api;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t.signInRequired }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t.invalidValue }, { status: 400 });

  const { error } = await db()
    .from("omtana_meditations")
    .update({ visibility: parsed.data.visibility })
    .eq("id", (await params).id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: t.updateFailed }, { status: 500 });
  return NextResponse.json({ visibility: parsed.data.visibility });
}
