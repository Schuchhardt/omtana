"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/supabase";
import { destroySession, requireUser } from "@/lib/auth";
import { getLang } from "@/lib/lang";
import { copy, normalizeLang, LANG_COOKIE, LANG_COOKIE_MAX_AGE } from "@/lib/i18n";

const prefsSchema = z.object({
  locale: z.enum(["es", "en", "pt"]),
  defaultVoiceId: z.string().uuid().nullable(),
  defaultDuration: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
  prefs: z.object({
    daily_reminder: z.boolean(),
    voice_emails: z.boolean(),
    publish_by_default: z.boolean(),
    improve_service: z.boolean(),
  }),
});

export async function savePreferences(input: unknown) {
  const user = await requireUser();
  const t = copy(await getLang()).profile;

  const parsed = prefsSchema.safeParse(input);
  if (!parsed.success) return { error: t.saveError };

  const { error } = await db()
    .from("omtana_users")
    .update({
      locale: parsed.data.locale,
      default_voice_id: parsed.data.defaultVoiceId,
      default_duration: parsed.data.defaultDuration,
      prefs: parsed.data.prefs,
    })
    .eq("id", user.id);

  if (error) return { error: t.saveError };

  // El idioma del perfil manda sobre la cookie del selector de la cabecera; si
  // no, elegir acá no tendría efecto visible mientras haya cookie puesta.
  // Portugués no tiene interfaz todavía y la cookie se borra para que caiga en
  // el idioma del navegador.
  const store = await cookies();
  const asUi = normalizeLang(parsed.data.locale);
  if (asUi) {
    store.set(LANG_COOKIE, asUi, {
      path: "/",
      maxAge: LANG_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  } else {
    store.delete(LANG_COOKIE);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Borra la cuenta y todo lo que cuelga de ella. Las meditaciones publicadas se
 * quedan en el catálogo pero pierden el vínculo con la persona, tal como dicen
 * los términos.
 */
export async function deleteAccount() {
  const user = await requireUser();

  await db()
    .from("omtana_meditations")
    .update({ user_id: null, source: "curated" })
    .eq("user_id", user.id)
    .eq("visibility", "public");

  await db().from("omtana_users").delete().eq("id", user.id);
  await destroySession();
  redirect("/");
}

/* ───────────────────────────── llaves MCP ───────────────────────────── */

const keyNameSchema = z.string().trim().max(60);

/**
 * Crea una llave para que un asistente use el MCP con esta cuenta. La llave
 * entera se devuelve una sola vez; en la base queda su hash.
 */
export async function createMcpKey(name: unknown) {
  const user = await requireUser();
  const t = copy(await getLang()).profile.mcp;
  const parsed = keyNameSchema.safeParse(name);
  try {
    const { createApiKey } = await import("@/lib/mcp/api-keys");
    const { key, row } = await createApiKey(user.id, parsed.success ? parsed.data : "");
    revalidatePath("/perfil");
    return { key, prefix: row.prefix };
  } catch (err) {
    return { error: err instanceof Error && /llaves activas/.test(err.message) ? err.message : t.createError };
  }
}

export async function revokeMcpKey(keyId: unknown) {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(keyId);
  if (!id.success) return { ok: false };
  const { revokeApiKey } = await import("@/lib/mcp/api-keys");
  const ok = await revokeApiKey(id.data, user.id);
  revalidatePath("/perfil");
  return { ok };
}
