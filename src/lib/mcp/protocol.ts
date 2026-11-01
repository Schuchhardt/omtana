import { z } from "zod";

/**
 * Servidor MCP mínimo sobre "Streamable HTTP", sin estado.
 *
 * Por qué a mano y no con el SDK: las rutas corren en una función de Netlify
 * que nace y muere en cada petición, así que no hay sesión que guardar ni
 * stream SSE que mantener abierto. Lo que queda del protocolo es JSON-RPC por
 * POST — `initialize`, `tools/list`, `tools/call`, `ping` — y eso son pocas
 * líneas que se pueden probar con un `Request` en la mano, con las mismas
 * dependencias que ya tiene el proyecto (zod para validar y para el JSON
 * Schema de cada herramienta).
 *
 * Lo que sí respeta de la especificación (2025-11-25, compatible hacia atrás):
 * - POST con uno o varios mensajes JSON-RPC. Solo notificaciones o respuestas
 *   → 202 sin cuerpo. Con peticiones → `application/json`.
 * - GET y DELETE → 405: el servidor no ofrece stream ni sesiones.
 * - `Origin` presente y desconocido → 403 (protección contra DNS rebinding).
 * - `MCP-Protocol-Version` que no se conoce → 400.
 * - Sin credencial válida → 401 con `WWW-Authenticate: Bearer`.
 * - Un error de validación de argumentos vuelve como resultado con `isError`,
 *   no como error de protocolo: así el modelo lo lee y corrige la llamada.
 *
 * Sin "server-only" ni alias `@/`: lo importan los tests directamente.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

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
  /** Ctx si la credencial sirve; null si no. */
  authenticate(request: Request): Promise<Ctx | null>;
  /** Orígenes de navegador permitidos además de ninguno. */
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
  params?: Record<string, unknown>;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id, error: { code, message, ...(data === undefined ? {} : { data }) } };
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
  return server.tools.map((tool) => ({
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

async function callTool<Ctx>(server: McpServer<Ctx>, ctx: Ctx, params: Record<string, unknown> | undefined, id: JsonRpcId) {
  const name = typeof params?.name === "string" ? params.name : "";
  const tool = server.tools.find((t) => t.name === name);
  if (!tool) return rpcError(id, INVALID_PARAMS, `Herramienta desconocida: ${name || "(sin nombre)"}`);

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
    return { jsonrpc: "2.0" as const, id, result: toolFailure(message) };
  }

  try {
    const value = await tool.run(parsed.data, ctx);
    await finish(true);
    return { jsonrpc: "2.0" as const, id, result: toolResult(value) };
  } catch (err) {
    if (err instanceof ToolError) {
      await finish(false, err.message);
      return { jsonrpc: "2.0" as const, id, result: toolFailure(err.message, err.details) };
    }
    server.onError?.(err, { tool: name, ctx });
    const message = err instanceof Error ? err.message : String(err);
    await finish(false, message);
    return {
      jsonrpc: "2.0" as const,
      id,
      result: toolFailure("La herramienta falló por un problema interno. Quedó registrado; intenta de nuevo en un momento."),
    };
  }
}

async function handleMessage<Ctx>(server: McpServer<Ctx>, ctx: Ctx, msg: JsonRpcRequest) {
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize": {
      const requested = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
      return {
        jsonrpc: "2.0" as const,
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, title: server.title, version: server.version },
          instructions: server.instructions,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0" as const, id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0" as const, id, result: { tools: describeTools(server) } };
    case "tools/call":
      return callTool(server, ctx, msg.params, id);
    default:
      return rpcError(id, METHOD_NOT_FOUND, `Método no soportado: ${msg.method}`);
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

/** Atiende una petición HTTP al servidor MCP. */
export async function handleMcp<Ctx>(request: Request, server: McpServer<Ctx>): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }

  const origin = request.headers.get("origin");
  if (origin && !(server.allowedOrigins ?? []).includes(origin)) {
    return json(rpcError(null, INVALID_REQUEST, `Origen no permitido: ${origin}`), 403);
  }

  const version = request.headers.get("mcp-protocol-version");
  if (version && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return json(rpcError(null, INVALID_REQUEST, `Versión de protocolo no soportada: ${version}`), 400);
  }

  const ctx = await server.authenticate(request);
  if (!ctx) {
    return json(
      rpcError(null, -32001, "Falta una credencial válida: manda `Authorization: Bearer <llave>`."),
      401,
      { "www-authenticate": `Bearer realm="${server.name}"` },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, PARSE_ERROR, "El cuerpo no es JSON válido."), 400);
  }

  const batch = Array.isArray(body);
  const messages = batch ? (body as unknown[]) : [body];
  if (messages.length === 0) return json(rpcError(null, INVALID_REQUEST, "Lote vacío."), 400);

  const responses: unknown[] = [];
  for (const msg of messages) {
    if (!isRequest(msg)) {
      // Una respuesta del cliente (no pedimos nada) o algo que no es JSON-RPC.
      const looksLikeResponse = !!msg && typeof msg === "object" && "jsonrpc" in msg && ("result" in msg || "error" in msg);
      if (!looksLikeResponse) responses.push(rpcError(null, INVALID_REQUEST, "Mensaje JSON-RPC inválido."));
      continue;
    }
    // Notificación (sin id): se acepta y no se contesta.
    if (msg.id === undefined) continue;
    try {
      responses.push(await handleMessage(server, ctx, msg));
    } catch (err) {
      responses.push(rpcError(msg.id ?? null, INTERNAL_ERROR, err instanceof Error ? err.message : String(err)));
    }
  }

  if (responses.length === 0) return new Response(null, { status: 202 });
  return json(batch ? responses : responses[0]);
}
