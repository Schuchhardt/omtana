import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Servidor de autorización OAuth 2.1 para los MCP de Omtana.
 *
 * Es lo que hace que Omtana se conecte desde claude.ai (Conectores) o desde
 * cualquier cliente MCP con un "Conectar" en vez de copiar una llave: el
 * cliente descubre el servidor de autorización desde el MCP (RFC 9728), la
 * persona inicia sesión y aprueba, y el cliente recibe un token atado a ese
 * MCP en particular.
 *
 * Lo que implementa, según la especificación de autorización de MCP 2026-07-28:
 * - Metadata del servidor de autorización (RFC 8414) y del recurso (RFC 9728).
 * - Código de autorización con PKCE S256 obligatorio, de un solo uso.
 * - `iss` en la respuesta de autorización (RFC 9207).
 * - Resource indicators (RFC 8707): el token sirve solo para el MCP pedido.
 * - Refresh tokens que rotan en cada uso; si uno ya usado vuelve a aparecer,
 *   se revoca el permiso entero (detección de robo).
 * - Clientes por Client ID Metadata Document (lo recomendado) o por registro
 *   dinámico (RFC 7591, deprecado pero lo que usan muchos clientes hoy).
 *
 * Este archivo es lógica pura: no sabe de Supabase ni de Next. El
 * almacenamiento es una interfaz (`OAuthStore`) para poder probar el flujo
 * completo en memoria.
 */

/* ───────────────────────────── constantes ───────────────────────────── */

export const ACCESS_TOKEN_TTL_S = 60 * 60;
export const REFRESH_TOKEN_TTL_S = 60 * 24 * 3600;
export const CODE_TTL_S = 10 * 60;

export const SCOPES = {
  user: "meditations",
  admin: "admin",
} as const;
export type ResourceKind = keyof typeof SCOPES;

const ACCESS_PREFIX = "omt_at_";
const REFRESH_PREFIX = "omt_rt_";
const CODE_PREFIX = "omt_ac_";
const CLIENT_PREFIX = "omc_";
const SECRET_PREFIX = "omcs_";

export const isAccessToken = (token: string) => token.startsWith(ACCESS_PREFIX);

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const random = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a), "hex");
  const y = Buffer.from(sha256(b), "hex");
  return timingSafeEqual(x, y);
}

/* ───────────────────────────── configuración ───────────────────────────── */

export interface OAuthConfig {
  /** El emisor: el sitio, sin barra final. */
  issuer: string;
  /** La URI canónica de cada MCP. */
  resources: Record<ResourceKind, string>;
}

export function oauthConfig(site: string): OAuthConfig {
  const issuer = site.replace(/\/+$/, "");
  return {
    issuer,
    resources: { user: `${issuer}/api/mcp`, admin: `${issuer}/api/mcp/admin` },
  };
}

/** Esquema y host en minúsculas, sin barra final ni fragmento: la forma canónica (RFC 8707). */
export function canonicalResource(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return null;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return null;
  }
}

export function resourceKind(cfg: OAuthConfig, resource: string | null | undefined): ResourceKind | null {
  if (!resource) return null;
  const wanted = canonicalResource(resource);
  if (!wanted) return null;
  for (const kind of Object.keys(cfg.resources) as ResourceKind[]) {
    if (canonicalResource(cfg.resources[kind]) === wanted) return kind;
  }
  return null;
}

export function resourceMetadataUrl(cfg: OAuthConfig, kind: ResourceKind): string {
  const path = new URL(cfg.resources[kind]).pathname;
  return `${cfg.issuer}/.well-known/oauth-protected-resource${path}`;
}

export function authorizationServerMetadata(cfg: OAuthConfig) {
  return {
    issuer: cfg.issuer,
    authorization_endpoint: `${cfg.issuer}/oauth/authorize`,
    token_endpoint: `${cfg.issuer}/api/oauth/token`,
    registration_endpoint: `${cfg.issuer}/api/oauth/register`,
    revocation_endpoint: `${cfg.issuer}/api/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [SCOPES.user, SCOPES.admin],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${cfg.issuer}/llms.txt`,
  };
}

export function protectedResourceMetadata(cfg: OAuthConfig, kind: ResourceKind) {
  return {
    resource: cfg.resources[kind],
    authorization_servers: [cfg.issuer],
    scopes_supported: [SCOPES[kind]],
    bearer_methods_supported: ["header"],
    resource_name: kind === "admin" ? "Omtana · Admin" : "Omtana",
    resource_documentation: `${cfg.issuer}/llms.txt`,
  };
}

/* ───────────────────────────── redirect URIs ───────────────────────────── */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * La especificación MCP: "All redirect URIs MUST be either localhost or use
 * HTTPS". Sin fragmento, sin credenciales en la URL.
 */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return !!url.hostname;
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  return false;
}

export function isLoopbackRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && LOOPBACK.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * ¿Este redirect_uri es uno de los registrados? Comparación exacta, salvo el
 * puerto de los de loopback: una app nativa elige puerto al vuelo y el
 * servidor tiene que aceptar cualquiera (RFC 8252 §7.3).
 */
export function redirectMatches(registered: string[], presented: string): boolean {
  if (registered.includes(presented)) return true;
  if (!isLoopbackRedirect(presented)) return false;
  const p = new URL(presented);
  return registered.some((r) => {
    if (!isLoopbackRedirect(r)) return false;
    const u = new URL(r);
    return u.hostname === p.hostname && u.pathname === p.pathname && u.search === p.search;
  });
}

export function redirectWith(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

/* ───────────────────────────── PKCE ───────────────────────────── */

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPkce(verifier: string | undefined, challenge: string): boolean {
  if (!verifier || !VERIFIER.test(verifier)) return false;
  return safeEqual(pkceChallenge(verifier), challenge);
}

/* ───────────────────────────── clientes ───────────────────────────── */

export type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";

export interface OAuthClient {
  client_id: string;
  client_name: string;
  client_uri?: string | null;
  logo_uri?: string | null;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: AuthMethod;
  /** Solo los registrados dinámicamente con secreto. */
  client_secret_hash?: string | null;
  /** 'cimd' si el client_id es la URL de su documento de metadata. */
  kind: "dcr" | "cimd";
}

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
  toJSON() {
    return { error: this.error, error_description: this.description };
  }
}

const strOrNull = (value: unknown, max = 500) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

const httpsOrNull = (value: unknown) => {
  const s = strOrNull(value, 2000);
  if (!s) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
};

/** Lo común entre un registro dinámico y un documento de metadata. */
function clientMetadata(body: Record<string, unknown>, opts: { allowSecret: boolean }) {
  const redirects = body.redirect_uris;
  if (!Array.isArray(redirects) || redirects.length === 0 || redirects.length > 10) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris es obligatorio (1 a 10).");
  }
  for (const uri of redirects) {
    if (typeof uri !== "string" || !isAllowedRedirectUri(uri)) {
      throw new OAuthError("invalid_redirect_uri", `redirect_uri no permitido: ${String(uri)}. Tiene que ser https o localhost.`);
    }
  }

  const method = (body.token_endpoint_auth_method ?? "none") as string;
  const allowed: string[] = opts.allowSecret ? ["none", "client_secret_post", "client_secret_basic"] : ["none"];
  if (!allowed.includes(method)) {
    throw new OAuthError("invalid_client_metadata", `token_endpoint_auth_method no soportado: ${method}.`);
  }

  const grants = Array.isArray(body.grant_types) ? (body.grant_types as unknown[]).map(String) : ["authorization_code", "refresh_token"];
  if (!grants.includes("authorization_code") || grants.some((g) => !["authorization_code", "refresh_token"].includes(g))) {
    throw new OAuthError("invalid_client_metadata", "grant_types tiene que ser authorization_code (y opcionalmente refresh_token).");
  }
  const responses = Array.isArray(body.response_types) ? (body.response_types as unknown[]).map(String) : ["code"];
  if (responses.some((r) => r !== "code")) {
    throw new OAuthError("invalid_client_metadata", 'response_types solo admite "code".');
  }

  return {
    client_name: strOrNull(body.client_name, 100),
    client_uri: httpsOrNull(body.client_uri),
    logo_uri: httpsOrNull(body.logo_uri),
    redirect_uris: redirects as string[],
    grant_types: grants,
    token_endpoint_auth_method: method as AuthMethod,
  };
}

/** Registro dinámico (RFC 7591). Devuelve el cliente y, si es confidencial, su secreto. */
export function registerClient(body: unknown): { client: OAuthClient; secret: string | null } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new OAuthError("invalid_client_metadata", "El cuerpo tiene que ser un objeto JSON.");
  }
  const meta = clientMetadata(body as Record<string, unknown>, { allowSecret: true });
  const secret = meta.token_endpoint_auth_method === "none" ? null : random(SECRET_PREFIX);
  return {
    secret,
    client: {
      ...meta,
      client_id: random(CLIENT_PREFIX),
      client_name: meta.client_name ?? "Cliente MCP",
      client_secret_hash: secret ? sha256(secret) : null,
      kind: "dcr",
    },
  };
}

/** ¿Este client_id es la URL de un Client ID Metadata Document? */
export function isMetadataDocumentId(clientId: string): boolean {
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" && url.pathname.length > 1 && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Valida un Client ID Metadata Document ya descargado. */
export function clientFromMetadataDocument(clientId: string, doc: unknown): OAuthClient {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new OAuthError("invalid_client", "El documento de metadata del cliente no es un objeto JSON.");
  }
  const body = doc as Record<string, unknown>;
  if (body.client_id !== clientId) {
    throw new OAuthError("invalid_client", "El client_id del documento no coincide con su URL.");
  }
  const meta = clientMetadata(body, { allowSecret: false });
  if (!meta.client_name) throw new OAuthError("invalid_client", "El documento de metadata no trae client_name.");
  return { ...meta, client_id: clientId, client_name: meta.client_name, kind: "cimd" };
}

/** Lo que se le muestra a la persona para que sepa quién pide acceso. */
export function clientHost(client: OAuthClient, redirectUri: string): { client: string | null; redirect: string } {
  return {
    client: client.kind === "cimd" ? new URL(client.client_id).host : null,
    redirect: new URL(redirectUri).host,
  };
}

/* ───────────────────────────── almacenamiento ───────────────────────────── */

export interface CodeRecord {
  code_hash: string;
  client_id: string;
  client_name: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string;
  expires_at: string;
  used_at: string | null;
  grant_id: string | null;
}

export interface GrantRecord {
  id: string;
  client_id: string;
  client_name: string;
  user_id: string;
  scope: string;
  resource: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface TokenRecord {
  token_hash: string;
  grant_id: string;
  kind: "access" | "refresh";
  expires_at: string;
  used_at: string | null;
}

export interface OAuthStore {
  getClient(clientId: string): Promise<OAuthClient | null>;
  saveCode(code: CodeRecord): Promise<void>;
  /** Marca el código como usado y lo devuelve; `alreadyUsed` si ya lo estaba. */
  consumeCode(codeHash: string, now: Date): Promise<{ code: CodeRecord; alreadyUsed: boolean } | null>;
  attachGrantToCode(codeHash: string, grantId: string): Promise<void>;
  createGrant(grant: Omit<GrantRecord, "id" | "created_at" | "last_used_at" | "revoked_at">): Promise<GrantRecord>;
  getGrant(id: string): Promise<GrantRecord | null>;
  revokeGrant(id: string, now: Date): Promise<void>;
  touchGrant(id: string, now: Date): Promise<void>;
  saveToken(token: TokenRecord): Promise<void>;
  getToken(tokenHash: string): Promise<TokenRecord | null>;
  /** Marca un refresh token como usado. False si otro lo usó antes (carrera o robo). */
  useRefreshToken(tokenHash: string, now: Date): Promise<boolean>;
}

/* ───────────────────────────── autorización ───────────────────────────── */

export interface AuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  state: string | undefined;
  codeChallenge: string;
  scope: string;
  resource: string;
  kind: ResourceKind;
}

/**
 * Errores de la petición de autorización. `redirect` dice si se pueden
 * devolver al cliente: hasta saber que el redirect_uri es suyo, no se
 * redirige a ninguna parte (para no ser un redirector abierto).
 */
export class AuthorizeError extends OAuthError {
  constructor(
    error: string,
    description: string,
    readonly redirect: { uri: string; state?: string } | null,
  ) {
    super(error, description);
  }
}

/** Valida una petición de autorización contra el cliente ya resuelto. */
export function validateAuthorizeRequest(
  cfg: OAuthConfig,
  client: OAuthClient | null,
  params: URLSearchParams | Record<string, string | undefined>,
): AuthorizeRequest {
  const get = (key: string) =>
    params instanceof URLSearchParams ? (params.get(key) ?? undefined) : (params[key] ?? undefined);

  if (!client) throw new AuthorizeError("invalid_client", "No conocemos esta aplicación (client_id).", null);

  const presented = get("redirect_uri");
  let redirectUri: string;
  if (presented) {
    if (!redirectMatches(client.redirect_uris, presented)) {
      throw new AuthorizeError("invalid_request", "El redirect_uri no está registrado para esta aplicación.", null);
    }
    redirectUri = presented;
  } else if (client.redirect_uris.length === 1) {
    redirectUri = client.redirect_uris[0];
  } else {
    throw new AuthorizeError("invalid_request", "Falta redirect_uri.", null);
  }

  const state = get("state");
  const back = { uri: redirectUri, state };

  if (get("response_type") !== "code") {
    throw new AuthorizeError("unsupported_response_type", 'Solo se admite response_type=code.', back);
  }
  const challenge = get("code_challenge");
  if (!challenge || !CHALLENGE.test(challenge)) {
    throw new AuthorizeError("invalid_request", "PKCE es obligatorio: falta code_challenge válido.", back);
  }
  if ((get("code_challenge_method") ?? "plain") !== "S256") {
    throw new AuthorizeError("invalid_request", "Solo se admite code_challenge_method=S256.", back);
  }

  // El recurso decide a qué MCP sirve el token. Sin `resource` (cliente viejo)
  // se deduce del scope; si no, es el MCP de personas.
  const requestedScopes = (get("scope") ?? "").split(/\s+/).filter(Boolean);
  const resourceParam = get("resource");
  let kind: ResourceKind | null;
  if (resourceParam) {
    kind = resourceKind(cfg, resourceParam);
    if (!kind) throw new AuthorizeError("invalid_target", `Este servidor no emite tokens para ${resourceParam}.`, back);
  } else {
    kind = requestedScopes.includes(SCOPES.admin) ? "admin" : "user";
  }

  // Cada recurso tiene un scope. `offline_access` se tolera (lo mandan algunos
  // clientes para pedir refresh token, que se emite igual); lo demás es error.
  const unknown = requestedScopes.filter((s) => s !== SCOPES[kind!] && s !== "offline_access");
  if (unknown.length) {
    throw new AuthorizeError("invalid_scope", `Scope no válido para este recurso: ${unknown.join(" ")}.`, back);
  }

  return {
    client,
    redirectUri,
    state,
    codeChallenge: challenge,
    scope: SCOPES[kind],
    resource: cfg.resources[kind],
    kind,
  };
}

/** Emite el código de autorización. Devuelve la URL a la que volver. */
export async function issueCode(
  cfg: OAuthConfig,
  store: OAuthStore,
  request: AuthorizeRequest,
  userId: string,
  now: Date = new Date(),
): Promise<string> {
  const code = random(CODE_PREFIX);
  await store.saveCode({
    code_hash: sha256(code),
    client_id: request.client.client_id,
    client_name: request.client.client_name,
    user_id: userId,
    redirect_uri: request.redirectUri,
    code_challenge: request.codeChallenge,
    scope: request.scope,
    resource: request.resource,
    expires_at: new Date(now.getTime() + CODE_TTL_S * 1000).toISOString(),
    used_at: null,
    grant_id: null,
  });
  return redirectWith(request.redirectUri, { code, state: request.state, iss: cfg.issuer });
}

export function denyUrl(cfg: OAuthConfig, request: Pick<AuthorizeRequest, "redirectUri" | "state">, error = "access_denied"): string {
  return redirectWith(request.redirectUri, {
    error,
    error_description: error === "access_denied" ? "La persona no autorizó el acceso." : undefined,
    state: request.state,
    iss: cfg.issuer,
  });
}

/* ───────────────────────────── token endpoint ───────────────────────────── */

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** Autentica al cliente en el token endpoint (o en revocación). */
export async function authenticateClient(
  store: OAuthStore,
  input: { clientId?: string; clientSecret?: string; basic?: string | null },
): Promise<OAuthClient> {
  let clientId = input.clientId;
  let secret = input.clientSecret;
  if (input.basic) {
    const match = input.basic.match(/^Basic\s+(.+)$/i);
    if (match) {
      const decoded = Buffer.from(match[1], "base64").toString("utf8");
      const cut = decoded.indexOf(":");
      if (cut > 0) {
        clientId = decodeURIComponent(decoded.slice(0, cut));
        secret = decodeURIComponent(decoded.slice(cut + 1));
      }
    }
  }
  if (!clientId) throw new OAuthError("invalid_client", "Falta client_id.", 401);
  const client = await store.getClient(clientId);
  if (!client) throw new OAuthError("invalid_client", "Cliente desconocido.", 401);

  if (client.token_endpoint_auth_method !== "none") {
    if (!secret || !client.client_secret_hash || !safeEqual(sha256(secret), client.client_secret_hash)) {
      throw new OAuthError("invalid_client", "Credenciales del cliente inválidas.", 401);
    }
  }
  return client;
}

async function issueTokens(store: OAuthStore, grant: GrantRecord, now: Date): Promise<TokenResponse> {
  const access = random(ACCESS_PREFIX);
  const refresh = random(REFRESH_PREFIX);
  await store.saveToken({
    token_hash: sha256(access),
    grant_id: grant.id,
    kind: "access",
    expires_at: new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000).toISOString(),
    used_at: null,
  });
  await store.saveToken({
    token_hash: sha256(refresh),
    grant_id: grant.id,
    kind: "refresh",
    expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000).toISOString(),
    used_at: null,
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refresh,
    scope: grant.scope,
  };
}

function checkResource(presented: string | undefined, expected: string) {
  if (!presented) return;
  if (canonicalResource(presented) !== canonicalResource(expected)) {
    throw new OAuthError("invalid_target", "El resource no coincide con el que se autorizó.");
  }
}

/** `grant_type=authorization_code` */
export async function exchangeCode(
  cfg: OAuthConfig,
  store: OAuthStore,
  client: OAuthClient,
  params: { code?: string; redirect_uri?: string; code_verifier?: string; resource?: string },
  now: Date = new Date(),
): Promise<TokenResponse> {
  if (!params.code) throw new OAuthError("invalid_request", "Falta code.");
  const consumed = await store.consumeCode(sha256(params.code), now);
  if (!consumed) throw new OAuthError("invalid_grant", "El código no existe.");
  const { code, alreadyUsed } = consumed;

  if (alreadyUsed) {
    // Un código que vuelve a aparecer: alguien lo interceptó. Lo emitido con él se revoca.
    if (code.grant_id) await store.revokeGrant(code.grant_id, now);
    throw new OAuthError("invalid_grant", "El código ya se usó.");
  }
  if (Date.parse(code.expires_at) < now.getTime()) throw new OAuthError("invalid_grant", "El código venció.");
  if (code.client_id !== client.client_id) throw new OAuthError("invalid_grant", "El código es de otra aplicación.");
  if (params.redirect_uri !== undefined && params.redirect_uri !== code.redirect_uri) {
    throw new OAuthError("invalid_grant", "El redirect_uri no coincide con el de la autorización.");
  }
  if (!verifyPkce(params.code_verifier, code.code_challenge)) {
    throw new OAuthError("invalid_grant", "El code_verifier no corresponde (PKCE).");
  }
  checkResource(params.resource, code.resource);

  const grant = await store.createGrant({
    client_id: code.client_id,
    client_name: code.client_name,
    user_id: code.user_id,
    scope: code.scope,
    resource: code.resource,
  });
  await store.attachGrantToCode(code.code_hash, grant.id);
  return issueTokens(store, grant, now);
}

/** `grant_type=refresh_token`, con rotación y detección de reuso. */
export async function refreshTokens(
  cfg: OAuthConfig,
  store: OAuthStore,
  client: OAuthClient,
  params: { refresh_token?: string; resource?: string; scope?: string },
  now: Date = new Date(),
): Promise<TokenResponse> {
  if (!params.refresh_token) throw new OAuthError("invalid_request", "Falta refresh_token.");
  const hash = sha256(params.refresh_token);
  const token = await store.getToken(hash);
  if (!token || token.kind !== "refresh") throw new OAuthError("invalid_grant", "Refresh token desconocido.");

  const grant = await store.getGrant(token.grant_id);
  if (!grant || grant.revoked_at) throw new OAuthError("invalid_grant", "El permiso fue revocado.");
  if (grant.client_id !== client.client_id) throw new OAuthError("invalid_grant", "El token es de otra aplicación.");

  const reused = async () => {
    // Un refresh token rotado que vuelve: alguien tiene una copia. Se corta todo.
    await store.revokeGrant(grant.id, now);
    return new OAuthError("invalid_grant", "El refresh token ya se usó: por seguridad se revocó el acceso.");
  };
  if (token.used_at) throw await reused();
  if (Date.parse(token.expires_at) < now.getTime()) throw new OAuthError("invalid_grant", "El refresh token venció.");
  checkResource(params.resource, grant.resource);
  if (params.scope) {
    const asked = params.scope.split(/\s+/).filter((s) => s && s !== "offline_access");
    if (asked.some((s) => s !== grant.scope)) throw new OAuthError("invalid_scope", "No se puede ampliar el scope al refrescar.");
  }
  // Marcarlo es atómico: si dos llegan a la vez, el segundo es un reuso.
  if (!(await store.useRefreshToken(hash, now))) throw await reused();

  await store.touchGrant(grant.id, now);
  return issueTokens(store, grant, now);
}

/** Revocación (RFC 7009): siempre responde bien; si el token es de este cliente, corta el permiso. */
export async function revokeToken(store: OAuthStore, client: OAuthClient, token: string | undefined, now: Date = new Date()) {
  if (!token) return;
  const record = await store.getToken(sha256(token));
  if (!record) return;
  const grant = await store.getGrant(record.grant_id);
  if (grant && grant.client_id === client.client_id) await store.revokeGrant(grant.id, now);
}

/* ───────────────────────────── servidor de recursos ───────────────────────────── */

export type AccessCheck =
  | { ok: true; grant: GrantRecord }
  | { ok: false; reason: "unknown" | "expired" | "revoked" | "audience" };

/**
 * ¿Sirve este access token para este MCP? Tiene que existir, no estar vencido,
 * su permiso no puede estar revocado y tiene que haberse emitido para este
 * recurso (RFC 8707): un token del MCP de personas no abre el de admin.
 */
export async function checkAccessToken(
  store: OAuthStore,
  token: string,
  expectedResource: string,
  now: Date = new Date(),
): Promise<AccessCheck> {
  if (!isAccessToken(token)) return { ok: false, reason: "unknown" };
  const record = await store.getToken(sha256(token));
  if (!record || record.kind !== "access") return { ok: false, reason: "unknown" };
  if (Date.parse(record.expires_at) < now.getTime()) return { ok: false, reason: "expired" };
  const grant = await store.getGrant(record.grant_id);
  if (!grant || grant.revoked_at) return { ok: false, reason: "revoked" };
  if (canonicalResource(grant.resource) !== canonicalResource(expectedResource)) return { ok: false, reason: "audience" };
  return { ok: true, grant };
}

export const ACCESS_FAILURE_TEXT: Record<Exclude<AccessCheck, { ok: true }>["reason"], string> = {
  unknown: "El token no existe.",
  expired: "El token venció: refréscalo.",
  revoked: "El acceso fue revocado.",
  audience: "Este token se emitió para otro servidor MCP.",
};

/**
 * Quiénes pueden conectar el MCP de administración por OAuth:
 * `OMTANA_ADMIN_EMAILS`, separados por coma. Se vuelve a mirar en cada
 * petición, así que sacar a alguien de la lista le corta el acceso al tiro.
 */
export function isAdminEmail(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const list = (env.OMTANA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}
