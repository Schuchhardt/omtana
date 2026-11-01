/**
 * El cliente oficial del SDK de MCP haciendo OAuth contra nuestro servidor.
 *
 * Se levanta un servidor HTTP de verdad con los mismos handlers que usan las
 * rutas de Next (`src/lib/oauth/handlers.ts`) y el mismo `handleMcp`, con el
 * almacenamiento en memoria en vez de Supabase. El cliente recorre lo que
 * hace claude.ai al apretar "Conectar":
 *
 *   401 + WWW-Authenticate → metadata del recurso → metadata del servidor de
 *   autorización → registro dinámico → autorización con PKCE y `resource` →
 *   canje del código → MCP con el token → refresh con rotación.
 *
 * La única pieza simulada es la persona aprobando en la pantalla de
 * consentimiento: `/oauth/authorize` acá aprueba sola (la página real pide
 * sesión y un clic, y valida con la misma función).
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auth, UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  ACCESS_FAILURE_TEXT,
  checkAccessToken,
  issueCode,
  oauthConfig,
  resourceMetadataUrl,
  validateAuthorizeRequest,
  type CodeRecord,
  type GrantRecord,
  type OAuthClient,
  type OAuthStore,
  type TokenRecord,
} from "../src/lib/oauth/core";
import { handleAuthServerMetadata, handleRegister, handleResourceMetadata, handleToken } from "../src/lib/oauth/handlers";
import { AuthFailure, defineTool, handleMcp, type McpServer } from "../src/lib/mcp/protocol";

/* ─── almacenamiento en memoria ─── */

const clients = new Map<string, OAuthClient>();
const codes = new Map<string, CodeRecord>();
const grants = new Map<string, GrantRecord>();
const tokens = new Map<string, TokenRecord>();

const store: OAuthStore = {
  getClient: async (id) => clients.get(id) ?? null,
  saveCode: async (c) => void codes.set(c.code_hash, { ...c }),
  async consumeCode(hash, now) {
    const c = codes.get(hash);
    if (!c) return null;
    if (c.used_at) return { code: { ...c }, alreadyUsed: true };
    c.used_at = now.toISOString();
    return { code: { ...c }, alreadyUsed: false };
  },
  attachGrantToCode: async (hash, id) => void (codes.get(hash) && (codes.get(hash)!.grant_id = id)),
  async createGrant(g) {
    const grant = { ...g, id: randomUUID(), created_at: new Date().toISOString(), last_used_at: null, revoked_at: null };
    grants.set(grant.id, grant);
    return { ...grant };
  },
  getGrant: async (id) => (grants.get(id) ? { ...grants.get(id)! } : null),
  revokeGrant: async (id, now) => void (grants.get(id) && (grants.get(id)!.revoked_at = now.toISOString())),
  touchGrant: async (id, now) => void (grants.get(id) && (grants.get(id)!.last_used_at = now.toISOString())),
  saveToken: async (t) => void tokens.set(t.token_hash, { ...t }),
  getToken: async (hash) => (tokens.get(hash) ? { ...tokens.get(hash)! } : null),
  async useRefreshToken(hash, now) {
    const t = tokens.get(hash);
    if (!t || t.kind !== "refresh" || t.used_at) return false;
    t.used_at = now.toISOString();
    return true;
  },
};

/* ─── el servidor ─── */

let base = "";
let approvals = 0;

const tool = defineTool<{ userId: string }>();
const mcp: McpServer<{ userId: string }> = {
  name: "omtana",
  title: "Omtana",
  version: "test",
  instructions: "Prueba",
  tools: [
    tool({
      name: "whoami",
      description: "Quién soy según el token.",
      input: z.object({}),
      run: async (_args, ctx) => ({ user: ctx.userId }),
    }),
  ],
  async authenticate(request) {
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return null;
    const check = await checkAccessToken(store, header.slice(7), oauthConfig(base).resources.user);
    return check.ok ? { userId: check.grant.user_id } : new AuthFailure("invalid", ACCESS_FAILURE_TEXT[check.reason]);
  },
  challenge: () => ({ resourceMetadata: resourceMetadataUrl(oauthConfig(base), "user"), scope: "meditations" }),
};

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }
  return new Request(`${base}${req.url}`, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
  });
}

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith("/.well-known/oauth-protected-resource")) {
    const rest = path.slice("/.well-known/oauth-protected-resource".length).split("/").filter(Boolean);
    return handleResourceMetadata(request, rest);
  }
  if (path === "/.well-known/oauth-authorization-server") return handleAuthServerMetadata(request);
  if (path === "/api/oauth/register") {
    return handleRegister(request, {
      saveClient: async (client) => void clients.set(client.client_id, client),
      recentRegistrations: async () => 0,
    });
  }
  if (path === "/api/oauth/token") return handleToken(request, store);
  if (path === "/oauth/authorize") {
    // La persona aprueba (en producción: sesión + clic en "Permitir").
    const cfg = oauthConfig(base);
    const client = await store.getClient(url.searchParams.get("client_id") ?? "");
    const req = validateAuthorizeRequest(cfg, client, url.searchParams);
    approvals++;
    return new Response(null, { status: 302, headers: { location: await issueCode(cfg, store, req, "user-42") } });
  }
  if (path === "/api/mcp") return handleMcp(request, mcp);
  return new Response("no", { status: 404 });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const response = await route(await toRequest(req));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

/* ─── el cliente: un proveedor OAuth como el de una app ─── */

class Provider implements OAuthClientProvider {
  info?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = "";
  lastAuthorizationUrl?: URL;
  get redirectUrl() {
    return "http://localhost:53682/callback";
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Cliente de prueba",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(t: OAuthTokens) {
    this.saved = t;
  }
  redirectToAuthorization(url: URL) {
    this.lastAuthorizationUrl = url;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
}

before(async () => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

/** "El navegador": sigue la URL de autorización y devuelve el código del redirect. */
async function approve(url: URL): Promise<{ code: string; iss: string | null; state: string | null }> {
  const res = await fetch(url, { redirect: "manual" });
  assert.equal(res.status, 302);
  const back = new URL(res.headers.get("location")!);
  return { code: back.searchParams.get("code")!, iss: back.searchParams.get("iss"), state: back.searchParams.get("state") };
}

describe("OAuth con el cliente oficial del SDK de MCP", () => {
  const provider = new Provider();

  test("sin token: el SDK descubre todo, se registra y pide autorizar con PKCE y resource", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { authProvider: provider });
    const client = new Client({ name: "sdk", version: "1" });
    await assert.rejects(client.connect(transport), UnauthorizedError);

    assert.match(String(provider.info?.client_id), /^omc_/, "se registró dinámicamente");
    const url = provider.lastAuthorizationUrl!;
    assert.equal(url.pathname, "/oauth/authorize");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("code_challenge"));
    assert.equal(url.searchParams.get("resource"), `${base}/api/mcp`);
    assert.equal(url.searchParams.get("scope"), "meditations");

    const { code, iss } = await approve(url);
    assert.equal(iss, base, "la vuelta trae iss (RFC 9207)");
    await transport.finishAuth(code);
    assert.match(String(provider.saved?.access_token), /^omt_at_/);
    assert.match(String(provider.saved?.refresh_token), /^omt_rt_/);
  });

  test("con el token: conecta y llama herramientas como la persona que aprobó", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { authProvider: provider });
    const client = new Client({ name: "sdk", version: "1" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["whoami"]);
    const result = await client.callTool({ name: "whoami", arguments: {} });
    assert.deepEqual(result.structuredContent, { user: "user-42" });
    await client.close();
  });

  test("refresh: el SDK rota el token y el viejo deja de servir", async () => {
    const before = provider.saved!;
    const outcome = await auth(provider, { serverUrl: `${base}/api/mcp` });
    assert.equal(outcome, "AUTHORIZED");
    assert.notEqual(provider.saved?.refresh_token, before.refresh_token);
    assert.notEqual(provider.saved?.access_token, before.access_token);

    const transport = new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { authProvider: provider });
    const client = new Client({ name: "sdk", version: "1" });
    await client.connect(transport);
    assert.deepEqual((await client.callTool({ name: "whoami", arguments: {} })).structuredContent, { user: "user-42" });
    await client.close();

    // Reusar el refresh token viejo es señal de robo: se revoca el acceso entero.
    const res = await fetch(`${base}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: before.refresh_token!, client_id: String(provider.info?.client_id) }),
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: string }).error, "invalid_grant");

    const revoked = await fetch(`${base}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${provider.saved?.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(revoked.status, 401);
    assert.match(revoked.headers.get("www-authenticate") ?? "", /invalid_token/);
    assert.equal(approvals, 1, "la persona aprobó una sola vez");
  });
});
