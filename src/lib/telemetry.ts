import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db, isConfigured } from "./supabase-client";
import { anthropicCost, elevenLabsCost, type AnthropicUsageLike } from "./pricing";

/**
 * Trazas: qué se gastó en cada llamada a un proveedor y qué pasó en cada paso.
 *
 * Dos tablas (migración 0008):
 *
 * - `omtana_usage_events`: una fila por llamada al modelo o a la voz, con los
 *   tokens o caracteres que informó el proveedor y el costo estimado.
 * - `omtana_logs`: la bitácora. Los pasos de la generación con su hora, los
 *   avisos al equipo y cada herramienta MCP que se llamó.
 *
 * El contexto (de qué meditación, job, plantilla o persona es la llamada) viaja
 * con `AsyncLocalStorage`: el motor envuelve la generación en `withTrace` y
 * todo lo que pasa adentro —la síntesis de una plantilla que se arma de paso,
 * por ejemplo— queda colgado de la sesión correcta sin pasar ids de mano en
 * mano por cada función.
 *
 * Nada de esto lanza nunca. Una traza que no se pudo guardar no puede tumbar
 * una generación que ya está pagada; a lo más se avisa una vez en el log.
 *
 * Sin "server-only" ni alias `@/`: lo importan las funciones de Netlify.
 */

export interface TraceContext {
  meditationId?: string | null;
  jobId?: string | null;
  templateId?: string | null;
  userId?: string | null;
  /** Por dónde entró el pedido: web, mcp, admin, cli, worker. */
  via?: string | null;
  /** Operación por defecto de lo que se registre adentro (voz, plantilla…). */
  operation?: string | null;
}

const store = new AsyncLocalStorage<TraceContext>();

/** Corre `fn` con este contexto sumado al que ya hubiera. */
export function withTrace<T>(ctx: TraceContext, fn: () => Promise<T>): Promise<T> {
  const parent = store.getStore() ?? {};
  const merged: TraceContext = { ...parent };
  for (const [key, value] of Object.entries(ctx) as [keyof TraceContext, string | null | undefined][]) {
    if (value !== undefined) merged[key] = value;
  }
  return store.run(merged, fn);
}

export function currentTrace(): TraceContext {
  return store.getStore() ?? {};
}

interface Deps {
  client?: SupabaseClient;
  env?: NodeJS.ProcessEnv;
  /** Por defecto, `console.warn`. */
  warn?: (...args: unknown[]) => void;
}

/** Tablas que faltan (migración sin aplicar): se avisa una vez y se deja de intentar. */
const missingTables = new Set<string>();

async function insert(table: string, row: Record<string, unknown>, deps: Deps): Promise<void> {
  if (missingTables.has(table)) return;
  if (!deps.client && !isConfigured()) return;
  const warn = deps.warn ?? console.warn;
  try {
    const { error } = await (deps.client ?? db()).from(table).insert(row);
    if (!error) return;
    if (/does not exist|could not find the table|schema cache/i.test(error.message)) {
      missingTables.add(table);
      warn(`[omtana:trazas] falta la tabla ${table}: corre "npm run db:push -- --solo 0008".`);
      return;
    }
    warn(`[omtana:trazas] no se guardó en ${table}: ${error.message}`);
  } catch (err) {
    warn(`[omtana:trazas] no se guardó en ${table}: ${err instanceof Error ? err.message : err}`);
  }
}

/** Solo para tests: vuelve a intentar las tablas que se dieron por faltantes. */
export function resetTelemetry(): void {
  missingTables.clear();
}

function traceColumns(ctx: TraceContext) {
  return {
    meditation_id: ctx.meditationId ?? null,
    job_id: ctx.jobId ?? null,
    template_id: ctx.templateId ?? null,
    user_id: ctx.userId ?? null,
  };
}

/* ───────────────────────────── uso y costo ───────────────────────────── */

export interface UsageRecord {
  provider: "anthropic" | "elevenlabs";
  model: string;
  operation?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  thinkingTokens?: number | null;
  webSearchRequests?: number;
  characters?: number;
  costUsd: number | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
  /** Contexto explícito; manda sobre el de `withTrace`. */
  trace?: TraceContext;
}

export async function recordUsage(record: UsageRecord, deps: Deps = {}): Promise<void> {
  const ctx = { ...currentTrace(), ...stripUndefined(record.trace ?? {}) };
  await insert(
    "omtana_usage_events",
    {
      provider: record.provider,
      model: record.model,
      operation: record.operation ?? ctx.operation ?? "",
      via: ctx.via ?? "",
      ...traceColumns(ctx),
      input_tokens: Math.round(record.inputTokens ?? 0),
      output_tokens: Math.round(record.outputTokens ?? 0),
      cache_read_tokens: Math.round(record.cacheReadTokens ?? 0),
      cache_creation_tokens: Math.round(record.cacheCreationTokens ?? 0),
      thinking_tokens: record.thinkingTokens ?? null,
      web_search_requests: Math.round(record.webSearchRequests ?? 0),
      characters: Math.round(record.characters ?? 0),
      cost_usd: record.costUsd,
      duration_ms: record.durationMs ?? null,
      metadata: record.metadata ?? {},
    },
    deps,
  );
}

/** Lo mínimo de una respuesta de Messages (beta o no) para medirla. */
export interface AnthropicResponseLike {
  model?: string;
  stop_reason?: string | null;
  usage?: AnthropicUsageLike | null;
  _request_id?: string | null;
}

/**
 * Registra una respuesta de la API de Anthropic. Se usa el modelo que vino en
 * la respuesta, no el pedido: con fallbacks pueden ser distintos, y el precio
 * es el del que respondió.
 */
export async function recordAnthropicUsage(
  input: {
    operation: string;
    requestedModel: string;
    response: AnthropicResponseLike;
    startedAt?: number;
    metadata?: Record<string, unknown>;
    trace?: TraceContext;
  },
  deps: Deps = {},
): Promise<void> {
  const usage = input.response.usage ?? {};
  const model = input.response.model || input.requestedModel;
  const fallbackModels = (usage.iterations ?? [])
    .filter((it) => it.type === "fallback_message" && it.model)
    .map((it) => it.model);

  await recordUsage(
    {
      provider: "anthropic",
      model,
      operation: input.operation,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      thinkingTokens: usage.output_tokens_details?.thinking_tokens ?? null,
      webSearchRequests: usage.server_tool_use?.web_search_requests ?? 0,
      costUsd: anthropicCost(model, usage),
      durationMs: input.startedAt ? Date.now() - input.startedAt : null,
      metadata: {
        requested_model: input.requestedModel,
        stop_reason: input.response.stop_reason ?? null,
        request_id: input.response._request_id ?? null,
        ...(fallbackModels.length ? { fallback_models: fallbackModels } : {}),
        ...input.metadata,
      },
      trace: input.trace,
    },
    deps,
  );
}

/** Registra una síntesis de voz. */
export async function recordTtsUsage(
  input: {
    model: string;
    characters: number;
    voiceId: string;
    startedAt?: number;
    requestId?: string | null;
    operation?: string;
  },
  deps: Deps = {},
): Promise<void> {
  await recordUsage(
    {
      provider: "elevenlabs",
      model: input.model,
      operation: input.operation ?? currentTrace().operation ?? "voz",
      characters: input.characters,
      costUsd: elevenLabsCost(input.characters, deps.env),
      durationMs: input.startedAt ? Date.now() - input.startedAt : null,
      metadata: { voice_id: input.voiceId, request_id: input.requestId ?? null },
    },
    deps,
  );
}

/* ───────────────────────────── bitácora ───────────────────────────── */

export type LogLevel = "debug" | "info" | "warn" | "error";

export async function logEvent(
  input: {
    level?: LogLevel;
    source: string;
    message: string;
    data?: Record<string, unknown>;
    trace?: TraceContext;
  },
  deps: Deps = {},
): Promise<void> {
  const ctx = { ...currentTrace(), ...stripUndefined(input.trace ?? {}) };
  await insert(
    "omtana_logs",
    {
      level: input.level ?? "info",
      source: input.source,
      message: input.message.slice(0, 4000),
      meditation_id: ctx.meditationId ?? null,
      job_id: ctx.jobId ?? null,
      user_id: ctx.userId ?? null,
      data: input.data ?? {},
    },
    deps,
  );
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
