import {
  authenticateClient,
  authorizationServerMetadata,
  exchangeCode,
  OAuthError,
  protectedResourceMetadata,
  refreshTokens,
  registerClient,
  revokeToken,
  type OAuthClient,
  type OAuthStore,
  type ResourceKind,
} from "./core";
import { clientIpHash, configFor, oauthErrorResponse, oauthJson, readParams } from "./http";

/**
 * Los endpoints OAuth como funciones `Request → Response` que reciben su
 * almacenamiento. Las rutas de Next (`src/app/api/oauth/*`, `.well-known`) los
 * envuelven con el store de Supabase; los tests, con uno en memoria, y así el
 * cliente oficial del SDK de MCP puede recorrer el flujo entero contra el
 * mismo código que corre en producción.
 */

const PUBLIC_CACHE = { "cache-control": "public, max-age=3600" };

/** RFC 8414 */
export function handleAuthServerMetadata(request: Request): Response {
  return oauthJson(authorizationServerMetadata(configFor(request)), 200, PUBLIC_CACHE);
}

const RESOURCE_BY_PATH: Record<string, ResourceKind> = {
  "": "user",
  "api/mcp": "user",
  "api/mcp/admin": "admin",
};

/**
 * RFC 9728. `/.well-known/oauth-protected-resource/api/mcp[/admin]`, y la raíz
 * para los clientes que la prueban cuando no les llegó `resource_metadata`.
 */
export function handleResourceMetadata(request: Request, path: string[]): Response {
  const kind = RESOURCE_BY_PATH[path.join("/")];
  if (!kind) return oauthJson({ error: "not_found" }, 404);
  return oauthJson(protectedResourceMetadata(configFor(request), kind), 200, PUBLIC_CACHE);
}

export interface RegistrationDeps {
  saveClient(client: OAuthClient, extra: { applicationType: string | null; registeredFrom: string | null }): Promise<void>;
  recentRegistrations(registeredFrom: string): Promise<number>;
}

/** Registros dinámicos permitidos por IP y por hora: el endpoint es abierto. */
export const MAX_REGISTRATIONS_PER_HOUR = 20;

/** RFC 7591 */
export async function handleRegister(request: Request, deps: RegistrationDeps): Promise<Response> {
  try {
    const body = (await request.json().catch(() => {
      throw new OAuthError("invalid_client_metadata", "El cuerpo tiene que ser JSON.");
    })) as Record<string, unknown>;

    const from = clientIpHash(request);
    if (from && (await deps.recentRegistrations(from)) >= MAX_REGISTRATIONS_PER_HOUR) {
      throw new OAuthError("invalid_client_metadata", "Demasiados registros desde esta dirección; intenta en una hora.", 429);
    }

    const { client, secret } = registerClient(body);
    const applicationType = typeof body?.application_type === "string" ? body.application_type.slice(0, 20) : null;
    await deps.saveClient(client, { applicationType, registeredFrom: from });

    return oauthJson(
      {
        client_id: client.client_id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_name: client.client_name,
        ...(client.client_uri ? { client_uri: client.client_uri } : {}),
        ...(client.logo_uri ? { logo_uri: client.logo_uri } : {}),
        redirect_uris: client.redirect_uris,
        grant_types: client.grant_types,
        response_types: ["code"],
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        ...(applicationType ? { application_type: applicationType } : {}),
      },
      201,
    );
  } catch (err) {
    return oauthErrorResponse(err);
  }
}

/** Token endpoint: canjea el código (con PKCE) y rota los refresh tokens. */
export async function handleToken(
  request: Request,
  store: OAuthStore,
  opts: { afterSuccess?: () => Promise<void> } = {},
): Promise<Response> {
  try {
    const params = await readParams(request);
    const cfg = configFor(request);
    const client = await authenticateClient(store, {
      clientId: params.client_id,
      clientSecret: params.client_secret,
      basic: request.headers.get("authorization"),
    });

    let tokens;
    switch (params.grant_type) {
      case "authorization_code":
        tokens = await exchangeCode(cfg, store, client, params);
        break;
      case "refresh_token":
        tokens = await refreshTokens(cfg, store, client, params);
        break;
      default:
        throw new OAuthError("unsupported_grant_type", "Solo authorization_code y refresh_token.");
    }

    await opts.afterSuccess?.().catch(() => undefined);
    return oauthJson(tokens);
  } catch (err) {
    return oauthErrorResponse(err);
  }
}

/** RFC 7009: responde 200 aunque el token no exista. */
export async function handleRevoke(request: Request, store: OAuthStore): Promise<Response> {
  try {
    const params = await readParams(request);
    const client = await authenticateClient(store, {
      clientId: params.client_id,
      clientSecret: params.client_secret,
      basic: request.headers.get("authorization"),
    });
    await revokeToken(store, client, params.token);
    return oauthJson({});
  } catch (err) {
    return oauthErrorResponse(err);
  }
}
