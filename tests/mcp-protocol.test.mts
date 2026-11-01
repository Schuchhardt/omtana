/**
 * El protocolo MCP sobre HTTP, sin red ni base: un servidor de juguete con dos
 * herramientas y peticiones `Request` armadas a mano, como las manda un
 * cliente (Claude Code, Claude Desktop, el conector de la API).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  AuthFailure,
  HEADER_MISMATCH,
  LATEST_LEGACY_VERSION,
  UNSUPPORTED_PROTOCOL_VERSION,
  ToolError,
  defineTool,
  handleMcp,
  type CallInfo,
  type McpServer,
} from "../src/lib/mcp/protocol";
import { isAdminToken, bearerToken } from "../src/lib/mcp/tokens";
import { allowedOrigins } from "../src/lib/mcp/origins";
import { env } from "./helpers/env.mjs";

interface Ctx {
  who: string;
}

const tool = defineTool<Ctx>();
const calls: CallInfo<Ctx>[] = [];
const errors: unknown[] = [];

const server: McpServer<Ctx> = {
  name: "prueba",
  title: "Prueba",
  version: "1.2.3",
  instructions: "Usa crear y después ver.",
  allowedOrigins: ["https://omtana.com"],
  tools: [
    tool({
      name: "crear",
      description: "Crea algo",
      input: z.object({
        texto: z.string().min(3),
        espera: z.number().int().min(0).max(45).default(0),
      }),
      annotations: { readOnlyHint: false },
      async run(args, ctx) {
        if (args.texto === "sin saldo") throw new ToolError("No te quedan créditos.", { planes: "/planes" });
        if (args.texto === "explota") throw new Error("detalle interno que no debe salir");
        return { id: "abc", texto: args.texto, espera: args.espera, quien: ctx.who };
      },
    }),
    tool({ name: "lista", description: "Una lista", input: z.object({}), run: async () => [1, 2, 3] }),
  ],
  async authenticate(request) {
    const auth = request.headers.get("authorization");
    if (!auth) return null;
    if (auth === "Bearer buena") return { who: "seba" };
    if (auth === "Bearer sin-permiso") return new AuthFailure("forbidden", "Sin acceso de administración.");
    return new AuthFailure("invalid", "El token venció: refréscalo.");
  },
  challenge: () => ({
    resourceMetadata: "https://omtana.com/.well-known/oauth-protected-resource/api/mcp",
    scope: "meditations",
  }),
  async onCall(info) {
    calls.push(info);
  },
  onError(err) {
    errors.push(err);
  },
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://omtana.com/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer buena",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function rpc(method: string, params?: unknown, id: number | string = 1) {
  const res = await handleMcp(post({ jsonrpc: "2.0", id, method, params }), server);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  return (await res.json()) as { id: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } };
}

describe("transporte", () => {
  test("GET y DELETE responden 405: no hay stream ni sesiones", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await handleMcp(new Request("https://omtana.com/api/mcp", { method }), server);
      assert.equal(res.status, 405);
      assert.equal(res.headers.get("allow"), "POST");
    }
  });

  test("sin credencial: 401 con el desafío que dispara OAuth (resource_metadata y scope)", async () => {
    const res = await handleMcp(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "" }), server);
    assert.equal(res.status, 401);
    const header = res.headers.get("www-authenticate") ?? "";
    assert.match(header, /^Bearer /);
    assert.match(header, /resource_metadata="https:\/\/omtana\.com\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
    assert.match(header, /scope="meditations"/);
    assert.doesNotMatch(header, /error=/);
  });

  test("token inválido: 401 con error=invalid_token", async () => {
    const res = await handleMcp(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "Bearer mala" }), server);
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate") ?? "", /error="invalid_token"/);
  });

  test("token válido sin permiso: 403 con error=insufficient_scope", async () => {
    const res = await handleMcp(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "Bearer sin-permiso" }), server);
    assert.equal(res.status, 403);
    assert.match(res.headers.get("www-authenticate") ?? "", /error="insufficient_scope"/);
  });

  test("un Origin desconocido se rechaza; el propio sitio pasa", async () => {
    const bad = await handleMcp(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://malo.example" }), server);
    assert.equal(bad.status, 403);
    const good = await handleMcp(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://omtana.com" }), server);
    assert.equal(good.status, 200);
  });

  test("MCP-Protocol-Version desconocida: 400", async () => {
    const res = await handleMcp(
      post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "1999-01-01" }),
      server,
    );
    assert.equal(res.status, 400);
  });

  test("JSON roto: 400 con parse error", async () => {
    const res = await handleMcp(post("{no es json"), server);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: { code: number } }).error.code, -32700);
  });

  test("solo notificaciones: 202 sin cuerpo", async () => {
    const res = await handleMcp(post({ jsonrpc: "2.0", method: "notifications/initialized" }), server);
    assert.equal(res.status, 202);
    assert.equal(await res.text(), "");
  });

  test("un lote vuelve como lote, sin respuesta para las notificaciones", async () => {
    const res = await handleMcp(
      post([
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]),
      server,
    );
    const body = (await res.json()) as { id: number }[];
    assert.deepEqual(body.map((r) => r.id), [1, 2]);
  });
});

describe("initialize", () => {
  test("acepta la versión que pide el cliente si la conoce", async () => {
    const { result } = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(result?.protocolVersion, "2025-06-18");
    assert.deepEqual(result?.serverInfo, { name: "prueba", title: "Prueba", version: "1.2.3" });
    assert.equal(result?.instructions, "Usa crear y después ver.");
    assert.ok((result?.capabilities as { tools?: unknown }).tools);
  });

  test("si no la conoce, ofrece la última de la era con initialize", async () => {
    const { result } = await rpc("initialize", { protocolVersion: "2099-01-01" });
    assert.equal(result?.protocolVersion, LATEST_LEGACY_VERSION);
  });

  test("un método desconocido es -32601", async () => {
    const { error } = await rpc("resources/list");
    assert.equal(error?.code, -32601);
  });
});

describe("herramientas", () => {
  test("tools/list publica un JSON Schema de objeto, con los defaults como opcionales", async () => {
    const { result } = await rpc("tools/list");
    const tools = result?.tools as { name: string; inputSchema: Record<string, unknown>; annotations?: unknown }[];
    assert.deepEqual(tools.map((t) => t.name), ["crear", "lista"]);
    const schema = tools[0].inputSchema as { type: string; required?: string[]; properties: Record<string, unknown> };
    assert.equal(schema.type, "object");
    assert.equal("$schema" in schema, false);
    assert.deepEqual(schema.required, ["texto"]);
    assert.ok(schema.properties.espera);
    assert.deepEqual(tools[1].inputSchema.type, "object");
  });

  test("una llamada exitosa vuelve como texto JSON y como structuredContent", async () => {
    const { result } = await rpc("tools/call", { name: "crear", arguments: { texto: "hola" } });
    assert.equal(result?.isError, undefined);
    const structured = result?.structuredContent as Record<string, unknown>;
    assert.deepEqual(structured, { id: "abc", texto: "hola", espera: 0, quien: "seba" });
    const [content] = result?.content as { type: string; text: string }[];
    assert.equal(content.type, "text");
    assert.deepEqual(JSON.parse(content.text), structured);
  });

  test("un arreglo vuelve como texto, sin structuredContent", async () => {
    const { result } = await rpc("tools/call", { name: "lista", arguments: {} });
    assert.equal(result?.structuredContent, undefined);
    assert.deepEqual(JSON.parse((result?.content as { text: string }[])[0].text), [1, 2, 3]);
  });

  test("argumentos inválidos: resultado con isError, para que el modelo corrija", async () => {
    const { result, error } = await rpc("tools/call", { name: "crear", arguments: { texto: "x", espera: 99 } });
    assert.equal(error, undefined);
    assert.equal(result?.isError, true);
    const text = (result?.content as { text: string }[])[0].text;
    assert.match(text, /texto/);
    assert.match(text, /espera/);
  });

  test("un ToolError llega tal cual, con sus detalles", async () => {
    const { result } = await rpc("tools/call", { name: "crear", arguments: { texto: "sin saldo" } });
    assert.equal(result?.isError, true);
    assert.deepEqual(result?.structuredContent, { error: "No te quedan créditos.", planes: "/planes" });
  });

  test("un error inesperado no filtra el detalle interno, pero se registra", async () => {
    errors.length = 0;
    const { result } = await rpc("tools/call", { name: "crear", arguments: { texto: "explota" } });
    assert.equal(result?.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /detalle interno/);
    assert.equal(errors.length, 1);
  });

  test("una herramienta que no existe es error de protocolo", async () => {
    const { error } = await rpc("tools/call", { name: "nada", arguments: {} });
    assert.equal(error?.code, -32602);
  });

  test("el registro de llamadas guarda los nombres de los argumentos, nunca sus valores", async () => {
    calls.length = 0;
    await rpc("tools/call", { name: "crear", arguments: { texto: "mi contexto privado" } });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].argKeys, ["texto"]);
    assert.equal(calls[0].ok, true);
    assert.doesNotMatch(JSON.stringify(calls[0]), /contexto privado/);
  });
});

describe("credenciales", () => {
  const req = (auth?: string) =>
    new Request("https://omtana.com/api/mcp/admin", { method: "POST", headers: auth ? { authorization: auth } : {} });
  const token = "t".repeat(40);

  test("el token de admin se compara contra la variable, con rotación por coma", () => {
    const vars = env({ OMTANA_ADMIN_MCP_TOKEN: `viejo-${"x".repeat(30)}, ${token}` });
    assert.equal(isAdminToken(req(`Bearer ${token}`), vars), true);
    assert.equal(isAdminToken(req(`Bearer viejo-${"x".repeat(30)}`), vars), true);
    assert.equal(isAdminToken(req("Bearer otro"), vars), false);
    assert.equal(isAdminToken(req(), vars), false);
  });

  test("sin variable, o con un token corto, el admin no existe", () => {
    assert.equal(isAdminToken(req(`Bearer ${token}`), env({})), false);
    assert.equal(isAdminToken(req("Bearer corto"), env({ OMTANA_ADMIN_MCP_TOKEN: "corto" })), false);
  });

  test("bearerToken lee el encabezado sin importar mayúsculas", () => {
    assert.equal(bearerToken(req("bearer omt_abc")), "omt_abc");
    assert.equal(bearerToken(req("Basic xyz")), null);
  });

  test("orígenes permitidos: el sitio y los de MCP_ALLOWED_ORIGINS", () => {
    assert.deepEqual(
      allowedOrigins(env({ NEXT_PUBLIC_SITE_URL: "https://omtana.com/", MCP_ALLOWED_ORIGINS: "http://localhost:6274/, https://x.dev" })),
      ["http://localhost:6274", "https://x.dev", "https://omtana.com"],
    );
  });
});

describe("era moderna (2026-07-28): sin initialize, versión en _meta", () => {
  const META = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "t", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };

  function modern(
    method: string,
    params: Record<string, unknown> = {},
    headers: Record<string, string> = {},
    meta: Record<string, unknown> = META,
  ) {
    const name: Record<string, string> = typeof params.name === "string" ? { "mcp-name": params.name } : {};
    return handleMcp(
      post(
        { jsonrpc: "2.0", id: 7, method, params: { ...params, _meta: meta } },
        {
          "mcp-protocol-version": String(meta["io.modelcontextprotocol/protocolVersion"]),
          "mcp-method": method,
          ...name,
          ...headers,
        },
      ),
      server,
    );
  }

  test("server/discover anuncia versiones, capacidades e identidad", async () => {
    const res = await modern("server/discover");
    assert.equal(res.status, 200);
    const { result } = (await res.json()) as { result: Record<string, unknown> };
    assert.equal(result.resultType, "complete");
    assert.ok((result.supportedVersions as string[]).includes("2026-07-28"));
    assert.ok((result.supportedVersions as string[]).includes("2025-11-25"));
    assert.ok((result.capabilities as { tools?: unknown }).tools);
    assert.deepEqual((result._meta as Record<string, unknown>)["io.modelcontextprotocol/serverInfo"], {
      name: "prueba",
      title: "Prueba",
      version: "1.2.3",
    });
    assert.equal(result.instructions, "Usa crear y después ver.");
    assert.equal(typeof result.ttlMs, "number");
  });

  test("tools/list lleva resultType, ttlMs y cacheScope, en orden determinista", async () => {
    const { result } = (await (await modern("tools/list")).json()) as { result: Record<string, unknown> };
    assert.equal(result.resultType, "complete");
    assert.equal(typeof result.ttlMs, "number");
    assert.equal(result.cacheScope, "private");
    assert.deepEqual((result.tools as { name: string }[]).map((t) => t.name), ["crear", "lista"]);
  });

  test("tools/call funciona sin initialize previo", async () => {
    const res = await modern("tools/call", { name: "crear", arguments: { texto: "hola" } });
    const { result } = (await res.json()) as { result: Record<string, unknown> };
    assert.equal(result.resultType, "complete");
    assert.equal((result.structuredContent as { texto: string }).texto, "hola");
  });

  test("Mcp-Name en base64 (formato centinela) se decodifica antes de comparar", async () => {
    const encoded = `=?base64?${Buffer.from("crear").toString("base64")}?=`;
    const res = await modern("tools/call", { name: "crear", arguments: { texto: "hola" } }, { "mcp-name": encoded });
    assert.equal(res.status, 200);
  });

  test("versión desconocida en _meta: 400 + UnsupportedProtocolVersion con las soportadas", async () => {
    const meta = { ...META, "io.modelcontextprotocol/protocolVersion": "2099-01-01" };
    const res = await modern("tools/list", {}, {}, meta);
    assert.equal(res.status, 400);
    const { error } = (await res.json()) as { error: { code: number; data: { supported: string[]; requested: string } } };
    assert.equal(error.code, UNSUPPORTED_PROTOCOL_VERSION);
    assert.equal(error.data.requested, "2099-01-01");
    assert.ok(error.data.supported.includes("2026-07-28"));
  });

  test("cabeceras que no calzan con el cuerpo: 400 + HeaderMismatch", async () => {
    const cases: Record<string, string>[] = [
      { "mcp-protocol-version": "2025-11-25" },
      { "mcp-method": "tools/list" },
      { "mcp-name": "lista" },
    ];
    for (const headers of cases) {
      const res = await modern("tools/call", { name: "crear", arguments: { texto: "hola" } }, headers);
      assert.equal(res.status, 400, JSON.stringify(headers));
      assert.equal(((await res.json()) as { error: { code: number } }).error.code, HEADER_MISMATCH);
    }
  });

  test("falta Mcp-Method: 400 + HeaderMismatch", async () => {
    const res = await handleMcp(
      post(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: META } },
        { "mcp-protocol-version": "2026-07-28" },
      ),
      server,
    );
    assert.equal(res.status, 400);
  });

  test("la cabecera dice 2026-07-28 pero el cuerpo no trae _meta: 400", async () => {
    const res = await handleMcp(
      post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" }),
      server,
    );
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: { code: number } }).error.code, HEADER_MISMATCH);
  });

  test("un método que no existe en la era moderna: 404 + -32601 (ping se eliminó)", async () => {
    const res = await modern("ping");
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { error: { code: number } }).error.code, -32601);
  });
});
