import "server-only";
import { randomBytes } from "node:crypto";
import { db, isConfigured } from "../supabase";
import { rollPeriod } from "../auth";
import { KEY_PREFIX, bearerToken, hashKey } from "./tokens";

export { KEY_PREFIX, bearerToken, hashKey, isAdminToken } from "./tokens";
import type { User } from "../types";

/**
 * Llaves para que un asistente actúe en nombre de una persona.
 *
 * El asistente no tiene la cookie del navegador, así que se presenta con
 * `Authorization: Bearer omt_…`. Igual que con las sesiones, en la base queda
 * solo el sha256: un volcado de la tabla no sirve para entrar. La llave entera
 * se muestra una sola vez, al crearla.
 */

/** Cada cuánto se actualiza `last_used_at`: no hace falta escribir en cada llamada. */
const TOUCH_EVERY_MS = 5 * 60_000;
export const MAX_KEYS_PER_USER = 10;

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export async function createApiKey(
  userId: string,
  name: string,
): Promise<{ key: string; row: ApiKeyRow }> {
  const { count } = await db()
    .from("omtana_api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if ((count ?? 0) >= MAX_KEYS_PER_USER) {
    throw new Error(`Ya tienes ${MAX_KEYS_PER_USER} llaves activas. Revoca alguna antes de crear otra.`);
  }

  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const { data, error } = await db()
    .from("omtana_api_keys")
    .insert({
      user_id: userId,
      name: name.trim().slice(0, 60) || "Asistente",
      token_hash: hashKey(key),
      prefix: key.slice(0, KEY_PREFIX.length + 8),
    })
    .select("id, user_id, name, prefix, last_used_at, revoked_at, created_at")
    .single();
  if (error || !data) throw new Error(`No se pudo crear la llave: ${error?.message ?? "sin detalle"}`);
  return { key, row: data as ApiKeyRow };
}

export async function listApiKeys(userId: string): Promise<ApiKeyRow[]> {
  if (!isConfigured()) return [];
  const { data } = await db()
    .from("omtana_api_keys")
    .select("id, user_id, name, prefix, last_used_at, revoked_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data as ApiKeyRow[]) ?? [];
}

/** Revoca una llave. Con `userId`, solo si es de esa persona. */
export async function revokeApiKey(keyId: string, userId?: string): Promise<boolean> {
  let query = db()
    .from("omtana_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .is("revoked_at", null);
  if (userId) query = query.eq("user_id", userId);
  const { data } = await query.select("id");
  return (data?.length ?? 0) > 0;
}

/** La persona dueña de la llave, o null si no sirve. */
export async function authenticateApiKey(
  request: Request,
): Promise<{ user: User; key: ApiKeyRow } | null> {
  if (!isConfigured()) return null;
  const token = bearerToken(request);
  if (!token || !token.startsWith(KEY_PREFIX) || token.length < 20) return null;

  const { data, error } = await db()
    .from("omtana_api_keys")
    .select("id, user_id, name, prefix, last_used_at, revoked_at, created_at, user:omtana_users(*)")
    .eq("token_hash", hashKey(token))
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;

  const user = (Array.isArray(data.user) ? data.user[0] : data.user) as User | null;
  if (!user) return null;

  const { user: _user, ...key } = data as ApiKeyRow & { user: unknown };
  void _user;
  if (!key.last_used_at || Date.now() - Date.parse(key.last_used_at) > TOUCH_EVERY_MS) {
    await db()
      .from("omtana_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", key.id);
  }

  // El cupo Free se reinicia la primera vez que la persona aparece en un mes
  // nuevo; por MCP también "aparece".
  return { user: await rollPeriod(user), key };
}
