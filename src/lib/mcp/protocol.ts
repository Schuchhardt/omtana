import { z } from "zod";

/**
 * Servidor MCP mínimo sobre "Streamable HTTP", sin estado y de las dos eras.
 *
 * Por qué a mano y no con el SDK: las rutas corren en una función de Netlify
 * que nace y muere en cada petición, así que no hay sesión que guardar ni
 * stream que mantener abierto. Lo que queda del protocolo es JSON-RPC por POST,
 * y eso se puede probar con un `Request` en la mano.
 *
 * Dos eras (ver la página "Versioning" de la especificación 2026-07-28):
 *
 * - **Moderna** (2026-07-28): no hay `initialize`. Cada petición trae su versión
 *   en `params._meta["io.modelcontextprotocol/protocolVersion"]`, repetida en la
 *   cabecera `MCP-Protocol-Version`, y las cabeceras `Mcp-Method` / `Mcp-Name`
 *   tienen que coincidir con el cuerpo (si no: 400 + `HeaderMismatch` -32020).
 *   Una versión que no conocemos: 400 + `UnsupportedProtocolVersion` -32022.
 *   Un método que no existe: 404 + -32601. `server/discover` es obligatorio y
 *   todo resultado lleva `resultType: "complete"`.
 * - **Legada** (2025-11-25 y antes): `initialize` + `notifications/initialized`,
 *   `ping`, lotes. Se atiende igual de sin estado: nunca se emite
 *   `Mcp-Session-Id`.
 *
 * Común a las dos:
 * - GET y DELETE → 405. Notificaciones → 202 sin cuerpo.
 * - `Origin` presente y desconocido → 403 (DNS rebinding).
 * - Sin credencial → 401 con `WWW-Authenticate: Bearer resource_metadata="…",
 *   scope="…"`, que es lo que dispara el flujo OAuth en el cliente.
 * - Un error de validación de argumentos vuelve como resultado con `isError`,
 *   no como error de protocolo: así el modelo lo lee y corrige la llamada.
 *
 * Sin "server-only" ni alias `@/`: lo importan los tests directamente.
 */

export const MODERN_PROTOCOL_VERSIONS = ["2026-07-28"] as const;
export const LEGACY_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const SUPPORTED_PROTOCOL_VERSIONS = [...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS];
export const LATEST_PROTOCOL_VERSION = MODERN_PROTOCOL_VERSIONS[0];
/** Lo más nuevo que se puede negociar con `initialize`. */
export const LATEST_LEGACY_VERSION = LEGACY_PROTOCOL_VERSIONS[0];

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

/** Cuánto puede cachear un cliente la lista de herramientas y el discover. */
const LIST_TTL_MS = 10 * 60_000;

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool<Ctx, S extends z.ZodType = z.ZodType> {
  name: string;
  title?: string;
  description: string;
  input: S;
  annotations?: ToolAnnotations;
  run(args: z.output<S>, ctx: Ctx): Promise<unknown>;
}

/** Para que TypeScript infiera los argumentos de `run` desde `input`. */
export function defineTool<Ctx>() {
  return <S extends z.ZodType>(tool: McpTool<Ctx, S>): McpTool<Ctx, S> => tool;
}

/**
 * Un error que se le explica al modelo tal cual: "no te quedan créditos", "esa
 * voz no existe". Cualquier otro error se reporta con un mensaje genérico y el
 * detalle va al registro.
 */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/**
 * Lo que `authenticate` devuelve cuando hay una credencial pero no sirve:
 * `invalid` (vencida, revocada, para otro recurso) → 401 con
 * `error="invalid_token"`; `forbidden` (válida pero sin permiso) → 403 con
 * `error="insufficient_scope"`.
 */
export class AuthFailure {
  constructor(
    readonly kind: "invalid" | "forbidden",
    readonly description: string,
  ) {}
}

/** Qué anunciar en `WWW-Authenticate` para que el cliente sepa cómo autorizarse. */
export interface AuthChallenge {
  /** URL del Protected Resource Metadata (RFC 9728). */
  resourceMetadata?: string;
  /** Scopes que pide este recurso. */
  scope?: string;
}

export interface CallInfo<Ctx> {
  tool: string;
  ctx: Ctx;
  ok: boolean;
  ms: number;
  /** Nombres de los argumentos, nunca sus valores: pueden traer datos personales. */
  argKeys: string[];
  error?: string;
}

export interface McpServer<Ctx> {
  name: string;
  title: string;
  version: string;
  /** Lo que el cliente le pasa al modelo como guía de uso del servidor. */
  instructions: string;
  // `any` en el esquema: cada herramienta tiene el suyo y acá solo importa que exista.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: McpTool<Ctx, any>[];
  /** El contexto si la credencial sirve; null si no vino ninguna. */
  authenticate(request: Request): Promise<Ctx | AuthFailure | null>;
  /** Cómo autorizarse, para el `WWW-Authenticate` de un 401/403. */
  challenge?(request: Request): AuthChallenge;
  /** Orígenes de navegador permitidos. Sin `Origin` (clientes nativos) pasa siempre. */
  allowedOrigins?: string[];
  /** Se llama después de cada `tools/call`. No debe lanzar. */
  onCall?(info: CallInfo<Ctx>): Promise<void>;
  /** Para errores inesperados dentro de una herramienta. */
  onError?(error: unknown, info: { tool: string; ctx: Ctx }): void;
}

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown> & { _meta?: Record<string, unknown> };
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const UNAUTHORIZED = -32001;
export const HEADER_MISMATCH = -32020;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

function rpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0" as const,
    ...(id === undefined ? {} : { id }),
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

/** El JSON Schema de entrada de una herramienta, tal como lo pide `tools/list`. */
export function inputSchemaOf(schema: z.ZodType): Record<string, unknown> {
  // `io: "input"`: lo que el cliente manda, así un campo con default es opcional.
  const out = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete out.$schema;
  if (out.type !== "object") return { type: "object", properties: {}, ...out };
  return out;
}

export function describeTools<Ctx>(server: McpServer<Ctx>) {
  // Orden determinista (lo pide la 2026-07-28 para que el cliente pueda cachear).
  return [...server.tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => ({
      name: tool.name,
      ...(tool.title ? { title: tool.title } : {}),
      description: tool.description,
      inputSchema: inputSchemaOf(tool.input),
      ...(tool.annotations ? { annotations: { ...(tool.title ? { title: tool.title } : {}), ...tool.annotations } } : {}),
    }));
}

function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "(argumentos)"}: ${issue.message}`)
    .join("; ");
}

/** Lo que devuelve una herramienta, en forma de resultado MCP. */
export function toolResult(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const structured =
    value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

function toolFailure(message: string, details?: Record<string, unknown>) {
  const body = details ? { error: message, ...details } : { error: message };
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], structuredContent: body, isError: true };
}

/* ───────────────────────────── cabeceras ───────────────────────────── */

const quote = (value: string) => `"${value.replace(/["\\]/g, "")}"`;

export function wwwAuthenticate(
  realm: string,
  challenge: AuthChallenge | undefined,
  failure?: AuthFailure,
): string {
  const parts = [`realm=${quote(realm)}`];
  if (failure) {
    parts.push(`error=${quote(failure.kind === "forbidden" ? "insufficient_scope" : "invalid_token")}`);
    parts.push(`error_description=${quote(failure.description)}`);
  }
  if (challenge?.resourceMetadata) parts.push(`resource_metadata=${quote(challenge.resourceMetadata)}`);
  if (challenge?.scope) parts.push(`scope=${quote(challenge.scope)}`);
  return `Bearer ${parts.join(", ")}`;
}

/** `Mcp-Name` puede venir en el formato centinela `=?base64?…?=`. */
export function decodeHeaderValue(value: string): string {
  const match = value.match(/^=\?base64\?([A-Za-z0-9+/=]*)\?=$/);
  return match ? Buffer.from(match[1], "base64").toString("utf8") : value;
}

/** El valor del cuerpo que `Mcp-Name` tiene que repetir, según el método. */
function nameFor(msg: JsonRpcRequest): string | null {
  if (msg.method === "tools/call" || msg.method === "prompts/get") {
    return typeof msg.params?.name === "string" ? msg.params.name : null;
  }
  if (msg.method === "resources/read") return typeof msg.params?.uri === "string" ? msg.params.uri : null;
  return null;
}

/* ───────────────────────────── despacho ───────────────────────────── */

function serverInfo<Ctx>(server: McpServer<Ctx>) {
  return { name: server.name, title: server.title, version: server.version };
}

async function callTool<Ctx>(server: McpServer<Ctx>, ctx: Ctx, params: Record<string, unknown> | undefined) {
  const name = typeof params?.name === "string" ? params.name : "";
  const tool = server.tools.find((t) => t.name === name);
  if (!tool) return { error: { code: INVALID_PARAMS, message: `Herramienta desconocida: ${name || "(sin nombre)"}` } };

  const rawArgs = (params?.arguments ?? {}) as Record<string, unknown>;
  const argKeys = rawArgs && typeof rawArgs === "object" ? Object.keys(rawArgs) : [];
  const started = Date.now();
  const finish = async (ok: boolean, error?: string) => {
    try {
      await server.onCall?.({ tool: name, ctx, ok, ms: Date.now() - started, argKeys, error });
    } catch {
      /* el registro no puede tumbar la respuesta */
    }
  };

  const parsed = tool.input.safeParse(rawArgs);
  if (!parsed.success) {
    const message = `Argumentos inválidos: ${zodMessage(parsed.error)}`;
    await finish(false, message);
    return { result: toolFailure(message) };
  }

  try {
    const value = await tool.run(parsed.data, ctx);
    await finish(true);
    return { result: toolResult(value) };
  } catch (err) {
    if (err instanceof ToolError) {
      await finish(false, err.message);
      return { result: toolFailure(err.message, err.details) };
    }
    server.onError?.(err, { tool: name, ctx });
    const message = err instanceof Error ? err.message : String(err);
    await finish(false, message);
    return {
      result: toolFailure("La herramienta falló por un problema interno. Quedó registrado; intenta de nuevo en un momento."),
    };
  }
}

type Outcome = { result: Record<string, unknown> } | { error: { code: number; message: string; data?: unknown } };

function discover<Ctx>(server: McpServer<Ctx>): Record<string, unknown> {
  return {
    supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
    capabilities: { tools: { listChanged: false } },
    instructions: server.instructions,
    ttlMs: LIST_TTL_MS,
    cacheScope: "private",
  };
}

/** Un mensaje de la era moderna (2026-07-28): sin sesión, con `_meta`. */
async function modern<Ctx>(server: McpServer<Ctx>, ctx: Ctx, msg: JsonRpcRequest): Promise<Outcome | null> {
  let outcome: Outcome | null;
  switch (msg.method) {
    case "server/discover":
      outcome = { result: discover(server) };
      break;
    case "tools/list":
      outcome = { result: { tools: describeTools(server), ttlMs: LIST_TTL_MS, cacheScope: "private" } };
      break;
    case "tools/call":
      outcome = await callTool(server, ctx, msg.params);
      break;
    default:
      return null; // → 404
  }
  if ("result" in outcome) {
    outcome.result = {
      resultType: "complete",
      ...outcome.result,
      _meta: { [META_SERVER_INFO]: serverInfo(server) },
    };
  }
  return outcome;
}

/** Un mensaje de la era legada (2025-11-25 y antes). */
async function legacy<Ctx>(server: McpServer<Ctx>, ctx: Ctx, msg: JsonRpcRequest): Promise<Outcome> {
  switch (msg.method) {
    case "initialize": {
      const requested = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
      const protocolVersion = (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : LATEST_LEGACY_VERSION;
      return {
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: serverInfo(server),
          instructions: server.instructions,
        },
      };
    }
    case "ping":
      return { result: {} };
    case "server/discover":
      return { result: { resultType: "complete", ...discover(server), _meta: { [META_SERVER_INFO]: serverInfo(server) } } };
    case "tools/list":
      return { result: { tools: describeTools(server) } };
    case "tools/call":
      return callTool(server, ctx, msg.params);
    default:
      return { error: { code: METHOD_NOT_FOUND, message: `Método no soportado: ${msg.method}` } };
  }
}

function isRequest(value: unknown): value is JsonRpcRequest {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (value as { method?: unknown }).method === "string"
  );
}

function reply(id: JsonRpcId, outcome: Outcome) {
  return "result" in outcome
    ? { jsonrpc: "2.0" as const, id, result: outcome.result }
    : { jsonrpc: "2.0" as const, id, error: outcome.error };
}

/** Valida las cabeceras de una petición moderna. Null si están bien. */
function modernHeaderProblem(request: Request, msg: JsonRpcRequest, version: string): string | null {
  const header = request.headers.get("mcp-protocol-version");
  if (header !== version) {
    return `MCP-Protocol-Version (${header ?? "ausente"}) no coincide con _meta (${version}).`;
  }
  if (msg.id === undefined) return null; // las notificaciones no tienen cabeceras definidas
  const method = request.headers.get("mcp-method");
  if (method !== msg.method) {
    return `Mcp-Method (${method ?? "ausente"}) no coincide con el cuerpo (${msg.method}).`;
  }
  const expected = nameFor(msg);
  if (expected !== null) {
    const raw = request.headers.get("mcp-name");
    if (raw === null) return `Falta Mcp-Name para ${msg.method}.`;
    if (decodeHeaderValue(raw) !== expected) return `Mcp-Name no coincide con el cuerpo (${expected}).`;
  }
  return null;
}

/** Atiende una petición HTTP al servidor MCP. */
export async function handleMcp<Ctx>(request: Request, server: McpServer<Ctx>): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }

  const origin = request.headers.get("origin");
  if (origin && !(server.allowedOrigins ?? []).includes(origin)) {
    return json(rpcError(undefined, INVALID_REQUEST, `Origen no permitido: ${origin}`), 403);
  }

  const auth = await server.authenticate(request);
  if (!auth || auth instanceof AuthFailure) {
    const failure = auth instanceof AuthFailure ? auth : undefined;
    const forbidden = failure?.kind === "forbidden";
    return json(
      rpcError(
        undefined,
        UNAUTHORIZED,
        failure?.description ?? "Falta autorización: conéctate con OAuth o manda `Authorization: Bearer <llave>`.",
      ),
      forbidden ? 403 : 401,
      { "www-authenticate": wwwAuthenticate(server.name, server.challenge?.(request), failure) },
    );
  }
  const ctx = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, PARSE_ERROR, "El cuerpo no es JSON válido."), 400);
  }

  // Lotes: solo existieron en 2025-03-26. Se atienden como mensajes legados.
  if (Array.isArray(body)) {
    if (body.length === 0) return json(rpcError(null, INVALID_REQUEST, "Lote vacío."), 400);
    const responses: unknown[] = [];
    for (const msg of body) {
      if (!isRequest(msg)) {
        const isResponse = !!msg && typeof msg === "object" && ("result" in msg || "error" in msg);
        if (!isResponse) responses.push(rpcError(null, INVALID_REQUEST, "Mensaje JSON-RPC inválido."));
        continue;
      }
      if (msg.id === undefined) continue;
      try {
        responses.push(reply(msg.id, await legacy(server, ctx, msg)));
      } catch (err) {
        responses.push(rpcError(msg.id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err)));
      }
    }
    return responses.length ? json(responses) : new Response(null, { status: 202 });
  }

  if (!isRequest(body)) {
    const isResponse = !!body && typeof body === "object" && ("result" in body || "error" in body);
    return isResponse
      ? new Response(null, { status: 202 })
      : json(rpcError(null, INVALID_REQUEST, "Mensaje JSON-RPC inválido."), 400);
  }
  const msg = body;
  const metaVersion = msg.params?._meta?.[META_VERSION];
  const headerVersion = request.headers.get("mcp-protocol-version");

  try {
    /* ─── era moderna ─── */
    if (typeof metaVersion === "string") {
      if (!(MODERN_PROTOCOL_VERSIONS as readonly string[]).includes(metaVersion)) {
        return json(
          rpcError(msg.id ?? null, UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version", {
            supported: SUPPORTED_PROTOCOL_VERSIONS,
            requested: metaVersion,
          }),
          400,
        );
      }
      const problem = modernHeaderProblem(request, msg, metaVersion);
      if (problem) return json(rpcError(msg.id ?? null, HEADER_MISMATCH, `Header mismatch: ${problem}`), 400);
      if (msg.id === undefined) return new Response(null, { status: 202 });

      const outcome = await modern(server, ctx, msg);
      if (!outcome) {
        return json(rpcError(msg.id, METHOD_NOT_FOUND, `Método no soportado: ${msg.method}`), 404);
      }
      return json(reply(msg.id, outcome));
    }

    /* ─── era legada ─── */
    if (headerVersion && (MODERN_PROTOCOL_VERSIONS as readonly string[]).includes(headerVersion)) {
      return json(
        rpcError(msg.id ?? null, HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version ${headerVersion} sin _meta en el cuerpo.`),
        400,
      );
    }
    if (headerVersion && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(headerVersion)) {
      return json(
        rpcError(msg.id ?? null, UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version", {
          supported: SUPPORTED_PROTOCOL_VERSIONS,
          requested: headerVersion,
        }),
        400,
      );
    }
    if (msg.id === undefined) return new Response(null, { status: 202 });
    return json(reply(msg.id, await legacy(server, ctx, msg)));
  } catch (err) {
    return json(rpcError(msg.id ?? null, INTERNAL_ERROR, err instanceof Error ? err.message : String(err)));
  }
}
