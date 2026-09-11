import "server-only";
import { cookies } from "next/headers";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { db, isConfigured } from "./supabase";
import { SESSION_COOKIE, SESSION_DAYS } from "./config";
import type { User } from "./types";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

/* ───────────────────────────── contraseñas ───────────────────────────── */

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const derived = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/* ───────────────────────────── sesiones ───────────────────────────── */

/** En la base guardamos solo el hash: un volcado de la tabla no permite entrar. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);

  const { error } = await db().from("omtana_sessions").insert({
    token_hash: hashToken(token),
    user_id: userId,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(error.message);

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db().from("omtana_sessions").delete().eq("token_hash", hashToken(token));
  }
  store.delete(SESSION_COOKIE);
}

/** Usuario de la petición actual, o null. Nunca lanza. */
export async function currentUser(): Promise<User | null> {
  if (!isConfigured()) return null;

  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { data, error } = await db()
    .from("omtana_sessions")
    .select("expires_at, user:omtana_users(*)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (error || !data?.user) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  const user = (Array.isArray(data.user) ? data.user[0] : data.user) as User;
  return rollPeriod(user);
}

/** Igual que currentUser pero exige sesión; para rutas de API. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AuthError("Necesitas iniciar sesión.");
  return user;
}

export class AuthError extends Error {
  readonly status = 401;
}

/**
 * El cupo del plan Free es mensual. En vez de un cron, el contador se reinicia
 * la primera vez que el usuario aparece dentro de un mes nuevo.
 */
async function rollPeriod(user: User): Promise<User> {
  const currentPeriod = new Date();
  currentPeriod.setUTCDate(1);
  const period = currentPeriod.toISOString().slice(0, 10);

  if (user.period_started >= period) return user;

  const { data } = await db()
    .from("omtana_users")
    .update({ free_used_period: 0, period_started: period })
    .eq("id", user.id)
    .select("*")
    .maybeSingle();

  return (data as User) ?? { ...user, free_used_period: 0, period_started: period };
}

export async function purgeExpiredSessions(): Promise<void> {
  await db().from("omtana_sessions").delete().lt("expires_at", new Date().toISOString());
}
