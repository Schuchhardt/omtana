import "server-only";
import { db } from "../supabase";
import { fetchClientMetadata } from "./cimd";
import {
  isMetadataDocumentId,
  OAuthError,
  type CodeRecord,
  type GrantRecord,
  type OAuthClient,
  type OAuthStore,
  type TokenRecord,
} from "./core";

/**
 * `OAuthStore` sobre Supabase. Las operaciones que no pueden correr dos veces
 * (gastar un código, rotar un refresh token) son un `update … where used_at is
 * null` que devuelve la fila: si dos peticiones llegan juntas, solo una la
 * consigue.
 */

const GRANT_COLUMNS = "id, client_id, client_name, user_id, scope, resource, created_at, last_used_at, revoked_at";

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`OAuth: ${context}: ${error?.message ?? "sin detalle"}`);
}

export const supabaseOAuthStore: OAuthStore = {
  async getClient(clientId) {
    if (isMetadataDocumentId(clientId)) {
      try {
        return await fetchClientMetadata(clientId);
      } catch (err) {
        if (err instanceof OAuthError) return null;
        throw err;
      }
    }
    const { data } = await db()
      .from("omtana_oauth_clients")
      .select("client_id, client_secret_hash, client_name, client_uri, logo_uri, redirect_uris, grant_types, token_endpoint_auth_method")
      .eq("client_id", clientId)
      .maybeSingle();
    return data ? ({ ...(data as Omit<OAuthClient, "kind">), kind: "dcr" } as OAuthClient) : null;
  },

  async saveCode(code) {
    const { error } = await db().from("omtana_oauth_codes").insert(code);
    if (error) fail("no se guardó el código", error);
  },

  async consumeCode(codeHash, now) {
    const { data: claimed } = await db()
      .from("omtana_oauth_codes")
      .update({ used_at: now.toISOString() })
      .eq("code_hash", codeHash)
      .is("used_at", null)
      .select("*");
    if (claimed?.length) return { code: claimed[0] as CodeRecord, alreadyUsed: false };

    const { data: existing } = await db().from("omtana_oauth_codes").select("*").eq("code_hash", codeHash).maybeSingle();
    return existing ? { code: existing as CodeRecord, alreadyUsed: true } : null;
  },

  async attachGrantToCode(codeHash, grantId) {
    await db().from("omtana_oauth_codes").update({ grant_id: grantId }).eq("code_hash", codeHash);
  },

  async createGrant(grant) {
    const { data, error } = await db().from("omtana_oauth_grants").insert(grant).select(GRANT_COLUMNS).single();
    if (error || !data) fail("no se creó el permiso", error);
    return data as GrantRecord;
  },

  async getGrant(id) {
    const { data } = await db().from("omtana_oauth_grants").select(GRANT_COLUMNS).eq("id", id).maybeSingle();
    return (data as GrantRecord | null) ?? null;
  },

  async revokeGrant(id, now) {
    await db().from("omtana_oauth_grants").update({ revoked_at: now.toISOString() }).eq("id", id).is("revoked_at", null);
  },

  async touchGrant(id, now) {
    await db().from("omtana_oauth_grants").update({ last_used_at: now.toISOString() }).eq("id", id);
  },

  async saveToken(token) {
    const { error } = await db().from("omtana_oauth_tokens").insert(token);
    if (error) fail("no se guardó el token", error);
  },

  async getToken(tokenHash) {
    const { data } = await db()
      .from("omtana_oauth_tokens")
      .select("token_hash, grant_id, kind, expires_at, used_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    return (data as TokenRecord | null) ?? null;
  },

  async useRefreshToken(tokenHash, now) {
    const { data } = await db()
      .from("omtana_oauth_tokens")
      .update({ used_at: now.toISOString() })
      .eq("token_hash", tokenHash)
      .eq("kind", "refresh")
      .is("used_at", null)
      .select("token_hash");
    return (data?.length ?? 0) > 0;
  },
};

/** Los permisos de una persona, para /perfil. */
export async function listGrants(userId: string): Promise<GrantRecord[]> {
  const { data } = await db()
    .from("omtana_oauth_grants")
    .select(GRANT_COLUMNS)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return (data as GrantRecord[]) ?? [];
}

export async function revokeGrantFor(userId: string, grantId: string): Promise<boolean> {
  const { data } = await db()
    .from("omtana_oauth_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id");
  return (data?.length ?? 0) > 0;
}

/** Registro dinámico: guarda el cliente. */
export async function saveClient(client: OAuthClient, extra: { applicationType: string | null; registeredFrom: string | null }) {
  const { error } = await db().from("omtana_oauth_clients").insert({
    client_id: client.client_id,
    client_secret_hash: client.client_secret_hash ?? null,
    client_name: client.client_name,
    client_uri: client.client_uri ?? null,
    logo_uri: client.logo_uri ?? null,
    redirect_uris: client.redirect_uris,
    grant_types: client.grant_types,
    token_endpoint_auth_method: client.token_endpoint_auth_method,
    application_type: extra.applicationType,
    registered_from: extra.registeredFrom,
  });
  if (error) fail("no se registró el cliente", error);
}

/** Cuántos clientes registró esta IP en la última hora. */
export async function recentRegistrations(registeredFrom: string): Promise<number> {
  const { count } = await db()
    .from("omtana_oauth_clients")
    .select("client_id", { count: "exact", head: true })
    .eq("registered_from", registeredFrom)
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  return count ?? 0;
}

/** Limpia códigos y tokens vencidos hace más de un día. Barato, se llama de vez en cuando. */
export async function purgeExpired(): Promise<void> {
  const before = new Date(Date.now() - 864e5).toISOString();
  await db().from("omtana_oauth_codes").delete().lt("expires_at", before);
  await db().from("omtana_oauth_tokens").delete().lt("expires_at", before);
}
