"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/supabase";
import { createSession, hashPassword, verifyPassword } from "@/lib/auth";
import { getLang } from "@/lib/lang";
import { copy, type Copy } from "@/lib/i18n";
import type { User } from "@/lib/types";

export interface AuthState {
  error?: string;
}

/**
 * Los esquemas se arman por llamada porque los mensajes van en el idioma de
 * quien está en la pantalla, y ese solo se conoce en la petición.
 */
function schemas(t: Copy["access"]["errors"]) {
  const email = z.string().trim().toLowerCase().email(t.invalidEmail);
  const password = z.string().min(8, t.shortPassword);

  return {
    signup: z.object({
      name: z.string().trim().min(1, t.missingName).max(80),
      email,
      password,
      terms: z.literal("on", { message: t.mustAcceptTerms }),
    }),
    login: z.object({ email, password: z.string().min(1, t.missingPassword) }),
  };
}

export async function signup(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = copy(await getLang()).access.errors;
  const parsed = schemas(t).signup.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const { name, email: mail, password: pass } = parsed.data;

  const { data: existing } = await db()
    .from("omtana_users")
    .select("id")
    .eq("email", mail)
    .maybeSingle();

  if (existing) {
    return { error: t.emailTaken };
  }

  // Voz por defecto: la primera del banco, para que nadie empiece sin voz.
  const { data: voice } = await db()
    .from("omtana_voices")
    .select("id")
    .eq("active", true)
    .order("sort")
    .limit(1)
    .maybeSingle();

  const { data: user, error } = await db()
    .from("omtana_users")
    .insert({
      name,
      email: mail,
      password_hash: await hashPassword(pass),
      default_voice_id: voice?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !user) {
    return { error: t.createFailed };
  }

  await createSession(user.id);
  redirect("/home");
}

export async function login(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = copy(await getLang()).access.errors;
  const parsed = schemas(t).login.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { data } = await db()
    .from("omtana_users")
    .select("id, password_hash")
    .eq("email", parsed.data.email)
    .maybeSingle();

  const row = data as Pick<User, "id"> & { password_hash: string } | null;

  // Mismo mensaje en ambos casos: no confirmamos qué correos existen.
  const ok = row ? await verifyPassword(parsed.data.password, row.password_hash) : false;
  if (!row || !ok) {
    return { error: t.badCredentials };
  }

  await createSession(row.id);
  redirect("/home");
}
