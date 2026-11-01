/**
 * El servidor de autorización OAuth de los MCP, de punta a punta y en memoria:
 * registro, autorización con PKCE, canje, audiencia del token, rotación de
 * refresh tokens con detección de reuso, Client ID Metadata Documents y las
 * protecciones contra SSRF y redirecciones abiertas.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  authenticateClient,
  authorizationServerMetadata,
  AuthorizeError,
  canonicalResource,
  checkAccessToken,
  clientFromMetadataDocument,
  exchangeCode,
  isAdminEmail,
  isAllowedRedirectUri,
  issueCode,
  oauthConfig,
  OAuthError,
  pkceChallenge,
  protectedResourceMetadata,
  redirectMatches,
  refreshTokens,
  registerClient,
  resourceMetadataUrl,
  revokeToken,
  validateAuthorizeRequest,
  verifyPkce,
  type CodeRecord,
  type GrantRecord,
  type OAuthClient,
  type OAuthStore,
  type TokenRecord,
} from "../src/lib/oauth/core";
import { clearClientMetadataCache, fetchClientMetadata, isPublicAddress } from "../src/lib/oauth/cimd";
import { safeNext } from "../src/lib/safe-next";
import { env } from "./helpers/env.mjs";

const cfg = oauthConfig("https://omtana.com/");

/** Un OAuthStore en memoria, con las mismas garantías atómicas que el de Supabase. */
function memoryStore() {
  const clients = new Map<string, OAuthClient>();
  const codes = new Map<string, CodeRecord>();
  const grants = new Map<string, GrantRecord>();
  const tokens = new Map<string, TokenRecord>();
  const store: OAuthStore = {
    async getClient(id) {
      return clients.get(id) ?? null;
    },
    async saveCode(code) {
      codes.set(code.code_hash, { ...code });
    },
    async consumeCode(hash, now) {
      const code = codes.get(hash);
      if (!code) return null;
      if (code.used_at) return { code: { ...code }, alreadyUsed: true };
      code.used_at = now.toISOString();
      return { code: { ...code }, alreadyUsed: false };
    },
    async attachGrantToCode(hash, grantId) {
      const code = codes.get(hash);
      if (code) code.grant_id = grantId;
    },
    async createGrant(g) {
      const grant: GrantRecord = { ...g, id: randomUUID(), created_at: new Date().toISOString(), last_used_at: null, revoked_at: null };
      grants.set(grant.id, grant);
      return { ...grant };
    },
    async getGrant(id) {
      const g = grants.get(id);
      return g ? { ...g } : null;
    },
    async revokeGrant(id, now) {
      const g = grants.get(id);
      if (g && !g.revoked_at) g.revoked_at = now.toISOString();
    },
    async touchGrant(id, now) {
      const g = grants.get(id);
      if (g) g.last_used_at = now.toISOString();
    },
    async saveToken(t) {
      tokens.set(t.token_hash, { ...t });
    },
    async getToken(hash) {
      const t = tokens.get(hash);
      return t ? { ...t } : null;
    },
    async useRefreshToken(hash, now) {
      const t = tokens.get(hash);
      if (!t || t.kind !== "refresh" || t.used_at) return false;
      t.used_at = now.toISOString();
      return true;
    },
  };
  return { store, clients, grants };
}

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

function authorizeParams(clientId: string, extra: Record<string, string> = {}) {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    state: "estado-123",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    resource: cfg.resources.user,
    scope: "meditations",
    ...extra,
  };
}

let mem: ReturnType<typeof memoryStore>;
let client: OAuthClient;

beforeEach(() => {
  mem = memoryStore();
  client = registerClient({ client_name: "Claude", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" }).client;
  mem.clients.set(client.client_id, client);
});

/** Autoriza y canjea: lo que hace un cliente MCP al "Conectar". */
async function connect(resource = cfg.resources.user) {
  const req = validateAuthorizeRequest(cfg, client, authorizeParams(client.client_id, { resource, scope: resource.endsWith("/admin") ? "admin" : "meditations" }));
  const back = new URL(await issueCode(cfg, mem.store, req, "user-1"));
  const code = back.searchParams.get("code")!;
  const tokens = await exchangeCode(cfg, mem.store, client, { code, redirect_uri: CALLBACK, code_verifier: VERIFIER, resource });
  return { back, code, tokens };
}

describe("metadata", () => {
  test("el servidor de autorización anuncia PKCE S256, iss, CIMD y registro dinámico", () => {
    const meta = authorizationServerMetadata(cfg);
    assert.equal(meta.issuer, "https://omtana.com");
    assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
    assert.equal(meta.authorization_response_iss_parameter_supported, true);
    assert.equal(meta.client_id_metadata_document_supported, true);
    assert.equal(meta.registration_endpoint, "https://omtana.com/api/oauth/register");
    assert.deepEqual(meta.grant_types_supported, ["authorization_code", "refresh_token"]);
  });

  test("cada MCP tiene su recurso, su scope y su URL de metadata (con el path insertado)", () => {
    assert.deepEqual(protectedResourceMetadata(cfg, "user").authorization_servers, ["https://omtana.com"]);
    assert.equal(protectedResourceMetadata(cfg, "admin").resource, "https://omtana.com/api/mcp/admin");
    assert.deepEqual(protectedResourceMetadata(cfg, "admin").scopes_supported, ["admin"]);
    assert.equal(resourceMetadataUrl(cfg, "user"), "https://omtana.com/.well-known/oauth-protected-resource/api/mcp");
    assert.equal(resourceMetadataUrl(cfg, "admin"), "https://omtana.com/.well-known/oauth-protected-resource/api/mcp/admin");
  });

  test("la URI canónica ignora mayúsculas del host y la barra final", () => {
    assert.equal(canonicalResource("HTTPS://Omtana.com/api/mcp/"), "https://omtana.com/api/mcp");
    assert.equal(canonicalResource("https://omtana.com/api/mcp#x"), null);
  });
});

describe("registro de clientes", () => {
  test("redirect URIs: https o localhost, nada más", () => {
    assert.equal(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback"), true);
    assert.equal(isAllowedRedirectUri("http://localhost:33418/callback"), true);
    assert.equal(isAllowedRedirectUri("http://127.0.0.1:9000/cb"), true);
    assert.equal(isAllowedRedirectUri("http://evil.com/cb"), false);
    assert.equal(isAllowedRedirectUri("https://claude.ai/cb#frag"), false);
    assert.equal(isAllowedRedirectUri("javascript:alert(1)"), false);
    assert.equal(isAllowedRedirectUri("cursor://callback"), false);
  });

  test("un cliente confidencial recibe secreto y el token endpoint lo exige", async () => {
    const { client: confidential, secret } = registerClient({
      client_name: "Servidor",
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "client_secret_post",
    });
    assert.ok(secret?.startsWith("omcs_"));
    mem.clients.set(confidential.client_id, confidential);
    await assert.rejects(authenticateClient(mem.store, { clientId: confidential.client_id }), /Credenciales/);
    const basic = `Basic ${Buffer.from(`${confidential.client_id}:${secret}`).toString("base64")}`;
    assert.equal((await authenticateClient(mem.store, { basic })).client_id, confidential.client_id);
  });

  test("rechaza metadata inválida", () => {
    assert.throws(() => registerClient({ redirect_uris: [] }), OAuthError);
    assert.throws(() => registerClient({ redirect_uris: ["http://evil.com/cb"] }), /no permitido/);
    assert.throws(() => registerClient({ redirect_uris: [CALLBACK], grant_types: ["client_credentials"] }), OAuthError);
    assert.throws(() => registerClient({ redirect_uris: [CALLBACK], token_endpoint_auth_method: "private_key_jwt" }), OAuthError);
  });
});

describe("autorización", () => {
  test("el redirect de loopback acepta cualquier puerto (RFC 8252); el resto, exacto", () => {
    assert.equal(redirectMatches(["http://localhost:1234/callback"], "http://localhost:51999/callback"), true);
    assert.equal(redirectMatches(["http://localhost:1234/callback"], "http://localhost:51999/otra"), false);
    assert.equal(redirectMatches([CALLBACK], `${CALLBACK}/extra`), false);
  });

  test("un redirect_uri que no es del cliente no se usa ni para devolver el error", () => {
    assert.throws(
      () => validateAuthorizeRequest(cfg, client, authorizeParams(client.client_id, { redirect_uri: "https://evil.com/cb" })),
      (err: unknown) => err instanceof AuthorizeError && err.redirect === null,
    );
  });

  test("PKCE S256 es obligatorio", () => {
    for (const extra of [{ code_challenge: "" }, { code_challenge_method: "plain" }] as Record<string, string>[]) {
      assert.throws(
        () => validateAuthorizeRequest(cfg, client, authorizeParams(client.client_id, extra)),
        (err: unknown) => err instanceof AuthorizeError && err.redirect?.uri === CALLBACK,
      );
    }
  });

  test("resource ajeno → invalid_target; scope que no es del recurso → invalid_scope", () => {
    assert.throws(
      () => validateAuthorizeRequest(cfg, client, authorizeParams(client.client_id, { resource: "https://otro.com/mcp" })),
      (err: unknown) => err instanceof AuthorizeError && err.error === "invalid_target",
    );
    assert.throws(
      () => validateAuthorizeRequest(cfg, client, authorizeParams(client.client_id, { scope: "admin" })),
      (err: unknown) => err instanceof AuthorizeError && err.error === "invalid_scope",
    );
  });

  test("sin resource (cliente viejo) se deduce del scope", () => {
    const params: Record<string, string> = authorizeParams(client.client_id, { scope: "admin offline_access" });
    delete params.resource;
    assert.equal(validateAuthorizeRequest(cfg, client, params).kind, "admin");
  });

  test("la vuelta trae code, state e iss (RFC 9207)", async () => {
    const { back } = await connect();
    assert.equal(back.origin + back.pathname, CALLBACK);
    assert.equal(back.searchParams.get("state"), "estado-123");
    assert.equal(back.searchParams.get("iss"), "https://omtana.com");
    assert.match(back.searchParams.get("code") ?? "", /^omt_ac_/);
  });
});

describe("tokens", () => {
  test("PKCE con el vector del RFC 7636", () => {
    assert.equal(pkceChallenge(VERIFIER), CHALLENGE);
    assert.equal(verifyPkce(VERIFIER, CHALLENGE), true);
    assert.equal(verifyPkce("x".repeat(43), CHALLENGE), false);
    assert.equal(verifyPkce(undefined, CHALLENGE), false);
  });

  test("el access token sirve para su MCP y para ningún otro (audiencia)", async () => {
    const { tokens } = await connect();
    assert.match(tokens.access_token, /^omt_at_/);
    assert.equal(tokens.token_type, "Bearer");
    assert.equal(tokens.scope, "meditations");
    const ok = await checkAccessToken(mem.store, tokens.access_token, "https://omtana.com/api/mcp");
    assert.equal(ok.ok, true);
    const other = await checkAccessToken(mem.store, tokens.access_token, cfg.resources.admin);
    assert.deepEqual(other, { ok: false, reason: "audience" });
  });

  test("un verifier equivocado no canjea", async () => {
    const req = validateAuthorizeRequest(cfg, client, authorizeParams(client.client_id));
    const code = new URL(await issueCode(cfg, mem.store, req, "user-1")).searchParams.get("code")!;
    await assert.rejects(
      exchangeCode(cfg, mem.store, client, { code, redirect_uri: CALLBACK, code_verifier: "y".repeat(43) }),
      /PKCE/,
    );
  });

  test("un código reusado revoca todo lo que se emitió con él", async () => {
    const { code, tokens } = await connect();
    await assert.rejects(
      exchangeCode(cfg, mem.store, client, { code, redirect_uri: CALLBACK, code_verifier: VERIFIER }),
      /ya se usó/,
    );
    assert.deepEqual(await checkAccessToken(mem.store, tokens.access_token, cfg.resources.user), { ok: false, reason: "revoked" });
  });

  test("un código vencido o de otra app no canjea", async () => {
    const req = validateAuthorizeRequest(cfg, client, authorizeParams(client.client_id));
    const old = new Date(Date.now() - 11 * 60_000);
    const code = new URL(await issueCode(cfg, mem.store, req, "user-1", old)).searchParams.get("code")!;
    await assert.rejects(exchangeCode(cfg, mem.store, client, { code, code_verifier: VERIFIER }), /venció/);

    const req2 = validateAuthorizeRequest(cfg, client, authorizeParams(client.client_id));
    const code2 = new URL(await issueCode(cfg, mem.store, req2, "user-1")).searchParams.get("code")!;
    const intruder = registerClient({ client_name: "Otro", redirect_uris: [CALLBACK] }).client;
    await assert.rejects(exchangeCode(cfg, mem.store, intruder, { code: code2, code_verifier: VERIFIER }), /otra aplicación/);
  });

  test("el refresh token rota; usar uno viejo revoca el acceso entero", async () => {
    const { tokens } = await connect();
    const next = await refreshTokens(cfg, mem.store, client, { refresh_token: tokens.refresh_token });
    assert.notEqual(next.refresh_token, tokens.refresh_token);
    assert.equal((await checkAccessToken(mem.store, next.access_token, cfg.resources.user)).ok, true);

    await assert.rejects(refreshTokens(cfg, mem.store, client, { refresh_token: tokens.refresh_token }), /ya se usó/);
    assert.deepEqual(await checkAccessToken(mem.store, next.access_token, cfg.resources.user), { ok: false, reason: "revoked" });
    await assert.rejects(refreshTokens(cfg, mem.store, client, { refresh_token: next.refresh_token }), /revocado/);
  });

  test("refrescar no amplía el scope ni cambia el recurso", async () => {
    const { tokens } = await connect();
    await assert.rejects(refreshTokens(cfg, mem.store, client, { refresh_token: tokens.refresh_token, scope: "admin" }), /ampliar/);
    const { tokens: t2 } = await connect();
    await assert.rejects(
      refreshTokens(cfg, mem.store, client, { refresh_token: t2.refresh_token, resource: cfg.resources.admin }),
      /resource/,
    );
  });

  test("un access token vencido se rechaza", async () => {
    const { tokens } = await connect();
    const later = new Date(Date.now() + 2 * 3600_000);
    assert.deepEqual(await checkAccessToken(mem.store, tokens.access_token, cfg.resources.user, later), {
      ok: false,
      reason: "expired",
    });
  });

  test("revocar (RFC 7009) corta el permiso; un token ajeno no hace nada", async () => {
    const { tokens } = await connect();
    const other = registerClient({ client_name: "Otro", redirect_uris: [CALLBACK] }).client;
    await revokeToken(mem.store, other, tokens.refresh_token);
    assert.equal((await checkAccessToken(mem.store, tokens.access_token, cfg.resources.user)).ok, true);
    await revokeToken(mem.store, client, tokens.refresh_token);
    assert.deepEqual(await checkAccessToken(mem.store, tokens.access_token, cfg.resources.user), { ok: false, reason: "revoked" });
  });
});

describe("Client ID Metadata Documents", () => {
  const ID = "https://app.example.com/oauth/client.json";
  const doc = { client_id: ID, client_name: "Example", redirect_uris: ["http://127.0.0.1:3000/callback"] };

  test("el client_id del documento tiene que ser su URL", () => {
    assert.equal(clientFromMetadataDocument(ID, doc).kind, "cimd");
    assert.throws(() => clientFromMetadataDocument(ID, { ...doc, client_id: "https://otro.com/c.json" }), /no coincide/);
    assert.throws(() => clientFromMetadataDocument(ID, { ...doc, client_name: undefined }), /client_name/);
    assert.throws(() => clientFromMetadataDocument(ID, { ...doc, token_endpoint_auth_method: "client_secret_post" }), OAuthError);
  });

  test("se descarga una vez y se cachea", async () => {
    clearClientMetadataCache();
    let calls = 0;
    const download = async () => {
      calls++;
      return { body: JSON.stringify(doc), maxAgeMs: 60_000 };
    };
    const a = await fetchClientMetadata(ID, { download });
    const b = await fetchClientMetadata(ID, { download });
    assert.equal(a.client_name, "Example");
    assert.equal(b.client_id, ID);
    assert.equal(calls, 1);
  });

  test("no se descarga desde una IP ni desde http", async () => {
    clearClientMetadataCache();
    const download = async () => ({ body: "{}", maxAgeMs: 0 });
    await assert.rejects(fetchClientMetadata("https://169.254.169.254/latest/meta", { download }), /IP/);
    await assert.rejects(fetchClientMetadata("http://app.example.com/c.json", { download }), /https/);
  });

  test("SSRF: solo direcciones públicas", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"]) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
      assert.equal(isPublicAddress(ip), true, ip);
    }
  });
});

describe("detalles", () => {
  test("admins por email, sin importar mayúsculas", () => {
    const vars = env({ OMTANA_ADMIN_EMAILS: "seba@schuchhardt.cl, otra@omtana.com" });
    assert.equal(isAdminEmail("Seba@Schuchhardt.cl", vars), true);
    assert.equal(isAdminEmail("nadie@omtana.com", vars), false);
    assert.equal(isAdminEmail("seba@schuchhardt.cl", env({})), false);
  });

  test("next después del login: solo rutas internas", () => {
    assert.equal(safeNext("/oauth/authorize?client_id=x&state=y"), "/oauth/authorize?client_id=x&state=y");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "evil", "", null]) {
      assert.equal(safeNext(bad), null, String(bad));
    }
  });
});
