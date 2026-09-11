import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/supabase";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  locale: z.enum(["es", "en", "pt"]).default("es"),
  source: z.string().max(40).default("landing"),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ese correo no parece válido." }, { status: 400 });
  }

  await db().from("omtana_leads").upsert(parsed.data, { onConflict: "email" });
  return NextResponse.json({ ok: true });
}
