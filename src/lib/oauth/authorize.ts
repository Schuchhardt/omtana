import "server-only";
import { fetchClientMetadata } from "./cimd";
import {
  AuthorizeError,
  isMetadataDocumentId,
  OAuthError,
  redirectWith,
  validateAuthorizeRequest,
  type AuthorizeRequest,
  type OAuthClient,
  type OAuthConfig,
} from "./core";
import { supabaseOAuthStore } from "./store";

/**
 * Lo que comparten la pantalla de consentimiento (GET /oauth/authorize) y la
 * decisión (POST /api/oauth/authorize): las dos validan la petición entera
 * desde cero, así que el formulario no puede colar nada que la pantalla no
 * haya mostrado.
 */

export const AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "scope",
  "code_challenge",
  "code_challenge_method",
  "resource",
] as const;

export type AuthorizeOutcome =
  | { kind: "ok"; request: AuthorizeRequest }
  /** Error que se le devuelve al cliente por su redirect_uri ya validado. */
  | { kind: "redirect"; url: string }
  /** Error que se muestra acá: no hay a dónde volver con seguridad. */
  | { kind: "error"; message: string };

export function pickParams(source: URLSearchParams | FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of AUTHORIZE_PARAMS) {
    const value = source.get(key);
    if (typeof value === "string" && value.length <= 4000) out[key] = value;
  }
  return out;
}

async function resolveClient(clientId: string | undefined): Promise<OAuthClient | { error: string }> {
  if (!clientId) return { error: "Falta client_id." };
  if (isMetadataDocumentId(clientId)) {
    try {
      return await fetchClientMetadata(clientId);
    } catch (err) {
      return { error: err instanceof OAuthError ? err.description : "No se pudo leer el documento del cliente." };
    }
  }
  return (await supabaseOAuthStore.getClient(clientId)) ?? { error: "No conocemos esta aplicación (client_id)." };
}

export async function resolveAuthorize(
  cfg: OAuthConfig,
  params: Record<string, string | undefined>,
): Promise<AuthorizeOutcome> {
  const client = await resolveClient(params.client_id);
  if ("error" in client) return { kind: "error", message: client.error };
  try {
    return { kind: "ok", request: validateAuthorizeRequest(cfg, client, params) };
  } catch (err) {
    if (err instanceof AuthorizeError) {
      return err.redirect
        ? {
            kind: "redirect",
            url: redirectWith(err.redirect.uri, {
              error: err.error,
              error_description: err.description,
              state: err.redirect.state,
              iss: cfg.issuer,
            }),
          }
        : { kind: "error", message: err.description };
    }
    throw err;
  }
}
