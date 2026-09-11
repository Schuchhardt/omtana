import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";

const schema = z.object({ visibility: z.enum(["private", "public"]) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Necesitas iniciar sesión." }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Valor inválido." }, { status: 400 });

  const { error } = await db()
    .from("omtana_meditations")
    .update({ visibility: parsed.data.visibility })
    .eq("id", (await params).id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "No se pudo actualizar." }, { status: 500 });
  return NextResponse.json({ visibility: parsed.data.visibility });
}
