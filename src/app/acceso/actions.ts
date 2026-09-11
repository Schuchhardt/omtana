"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/supabase";
import { createSession, hashPassword, verifyPassword } from "@/lib/auth";
import type { User } from "@/lib/types";

export interface AuthState {
  error?: string;
}

const email = z.string().trim().toLowerCase().email("Ese correo no parece válido.");
const password = z.string().min(8, "La contraseña necesita al menos 8 caracteres.");

const signupSchema = z.object({
  name: z.string().trim().min(1, "Falta tu nombre.").max(80),
  email,
  password,
  terms: z.literal("on", { message: "Hay que aceptar los términos para crear la cuenta." }),
});

const loginSchema = z.object({ email, password: z.string().min(1, "Falta la contraseña.") });

export async function signup(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(form));
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
    return { error: "Ya hay una cuenta con ese correo. Entra en vez de crearla." };
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
    return { error: "No pudimos crear la cuenta. Intenta de nuevo." };
  }

  await createSession(user.id);
  redirect("/home");
}

export async function login(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
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
    return { error: "Correo o contraseña incorrectos." };
  }

  await createSession(row.id);
  redirect("/home");
}
