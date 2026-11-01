import "server-only";
import { db } from "../supabase";
import { isStale, type JobRow } from "../generation/jobs";
import { classifyGenerationError } from "../generation/errors";
import { generationRunner, BACKGROUND_FUNCTION_PATH } from "../generation/dispatch";
import { REQUIRED_ENV } from "../generation/health";
import { alertChannels } from "../alerts";
import { PLAN_VERSION, MODEL as TEMPLATE_MODEL } from "../generation/template";
import { MODEL as SCRIPT_MODEL } from "../generation/script";
import { MODEL as RESEARCH_MODEL } from "../curation/research";
import { MODEL_ID as TTS_MODEL } from "../generation/tts";
import { PROMPT_MODEL } from "../meditations/interpret";
import { PRICES_AS_OF, elevenLabsUsdPer1k, knownModels, modelPrice } from "../pricing";
import { paymentsEnabled } from "../payments";
import { APP_VERSION, BUILD_ID } from "../version";
import { MAX_SCRIPT_CHARS } from "../generation/custom-script";
import { MAX_ACTIVE_PER_USER, MAX_PROMPTS_PER_HOUR } from "../meditations/actions";
import { MAX_WAIT_SECONDS } from "../meditations/view";
import { channelOf } from "../types";

/**
 * Lo que mira el MCP de administración: el estado de todo, los errores, la
 * bitácora, la traza de una sesión y lo que cuesta cada cosa.
 *
 * Todo se calcula leyendo la base: ninguna de estas funciones llama a un
 * modelo ni gasta nada.
 */

const sinceIso = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
const usd = (n: number) => Math.round(n * 10_000) / 10_000;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;

/** PostgREST devuelve de a mil filas: se pagina hasta `max`. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  max = 20_000,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  const page = 1000;
  for (let from = 0; from < max; from += page) {
    const { data, error } = await build(from, Math.min(from + page, max) - 1);
    if (error) throw new Error(error.message);
    const batch = (data as T[]) ?? [];
    rows.push(...batch);
    if (batch.length < page) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

type CountQuery = {
  eq(column: string, value: unknown): CountQuery;
  gte(column: string, value: unknown): CountQuery;
  is(column: string, value: null): CountQuery;
} & PromiseLike<{ count: number | null; error: { message: string } | null }>;

/** Cuántas filas, sin traerlas. Null si la tabla no existe todavía. */
async function count(table: string, filter?: (q: CountQuery) => CountQuery): Promise<number | null> {
  const base = db().from(table).select("id", { count: "exact", head: true }) as unknown as CountQuery;
  const { count: n, error } = await (filter ? filter(base) : base);
  return error ? null : (n ?? 0);
}

function groupSum<T>(rows: T[], key: (r: T) => string, value: (r: T) => number) {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + value(r);
  return out;
}

/* ───────────────────────────── uso ───────────────────────────── */

export interface UsageRow {
  id: string;
  provider: string;
  model: string;
  operation: string;
  meditation_id: string | null;
  job_id: string | null;
  template_id: string | null;
  user_id: string | null;
  via: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  thinking_tokens: number | null;
  web_search_requests: number;
  characters: number;
  cost_usd: number | string | null;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function usageTotals(rows: UsageRow[]) {
  const cost = rows.reduce((n, r) => n + num(r.cost_usd), 0);
  return {
    cost_usd: usd(cost),
    calls: rows.length,
    calls_without_price: rows.filter((r) => r.cost_usd === null).length,
    input_tokens: rows.reduce((n, r) => n + r.input_tokens, 0),
    output_tokens: rows.reduce((n, r) => n + r.output_tokens, 0),
    thinking_tokens: rows.reduce((n, r) => n + (r.thinking_tokens ?? 0), 0),
    cache_read_tokens: rows.reduce((n, r) => n + r.cache_read_tokens, 0),
    cache_creation_tokens: rows.reduce((n, r) => n + r.cache_creation_tokens, 0),
    tts_characters: rows.reduce((n, r) => n + r.characters, 0),
    web_searches: rows.reduce((n, r) => n + r.web_search_requests, 0),
  };
}

function breakdown(rows: UsageRow[], key: (r: UsageRow) => string) {
  const groups = new Map<string, UsageRow[]>();
  for (const r of rows) {
    const k = key(r) || "(sin dato)";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([k, list]) => ({ key: k, ...usageTotals(list) }))
    .sort((a, b) => b.cost_usd - a.cost_usd);
}

async function usageSince(hours: number) {
  const since = sinceIso(hours);
  return fetchAll<UsageRow>((from, to) =>
    db()
      .from("omtana_usage_events")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, to),
  );
}

async function meditationsByIds(ids: string[]) {
  const out = new Map<string, { id: string; title: string; duration_seconds: number; status: string; user_id: string | null; created_via?: string; script_mode?: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db()
      .from("omtana_meditations")
      .select("id, title, duration_seconds, status, user_id, created_via, script_mode")
      .in("id", ids.slice(i, i + 200));
    for (const m of (data as { id: string; title: string; duration_seconds: number; status: string; user_id: string | null }[]) ?? []) {
      out.set(m.id, m);
    }
  }
  return out;
}

export type CostGroup = "day" | "provider" | "model" | "operation" | "via" | "user";

export async function costReport(opts: { sinceDays: number; groupBy: CostGroup[]; top: number }) {
  const { rows, truncated } = await usageSince(opts.sinceDays * 24);
  const perMeditation = groupSum(
    rows.filter((r) => r.meditation_id),
    (r) => r.meditation_id!,
    (r) => num(r.cost_usd),
  );
  const ids = Object.keys(perMeditation);
  const meditations = await meditationsByIds(ids);

  // Cuánto cuesta una sesión lista, por duración: lo que importa para fijar precios.
  const byDuration: Record<string, { sessions: number; cost: number }> = {};
  for (const [id, cost] of Object.entries(perMeditation)) {
    const m = meditations.get(id);
    if (!m || m.status !== "ready") continue;
    const bucket = m.script_mode === "completo" ? "guion propio" : `${Math.round(m.duration_seconds / 300) * 5} min`;
    byDuration[bucket] ??= { sessions: 0, cost: 0 };
    byDuration[bucket].sessions++;
    byDuration[bucket].cost += cost;
  }

  const keyOf: Record<CostGroup, (r: UsageRow) => string> = {
    day: (r) => r.created_at.slice(0, 10),
    provider: (r) => r.provider,
    model: (r) => r.model,
    operation: (r) => r.operation,
    via: (r) => r.via,
    user: (r) => r.user_id ?? "(sin persona)",
  };

  const readyCosts = Object.entries(perMeditation).filter(([id]) => meditations.get(id)?.status === "ready");
  return {
    period_days: opts.sinceDays,
    ...(truncated ? { warning: "Se leyeron las 20.000 llamadas más recientes: acota el período." } : {}),
    totals: usageTotals(rows),
    by_provider: breakdown(rows, keyOf.provider),
    groups: Object.fromEntries(opts.groupBy.map((g) => [g, breakdown(rows, keyOf[g])])),
    per_ready_meditation: {
      sessions: readyCosts.length,
      avg_cost_usd: readyCosts.length ? usd(readyCosts.reduce((n, [, c]) => n + c, 0) / readyCosts.length) : 0,
      by_duration: Object.fromEntries(
        Object.entries(byDuration).map(([k, v]) => [k, { sessions: v.sessions, avg_cost_usd: usd(v.cost / v.sessions) }]),
      ),
    },
    templates: {
      note: "Plantillas: se pagan una vez y las reutilizan todas las sesiones de esa intención, voz, idioma y duración.",
      ...usageTotals(rows.filter((r) => r.template_id)),
    },
    top_meditations: Object.entries(perMeditation)
      .sort((a, b) => b[1] - a[1])
      .slice(0, opts.top)
      .map(([id, cost]) => ({
        id,
        title: meditations.get(id)?.title ?? null,
        status: meditations.get(id)?.status ?? null,
        minutes: meditations.has(id) ? Math.round(meditations.get(id)!.duration_seconds / 60) : null,
        cost_usd: usd(cost),
      })),
    pricing: {
      as_of: PRICES_AS_OF,
      elevenlabs_usd_per_1k_chars: elevenLabsUsdPer1k(),
      note: "Costos estimados con la lista de precios pública; no es la factura.",
    },
  };
}

/* ───────────────────────────── resumen ───────────────────────────── */

export async function overview(days: number) {
  const since = sinceIso(days * 24);
  const [usersTotal, usersPro, usersNew, keysActive] = await Promise.all([
    count("omtana_users"),
    count("omtana_users", (q) => q.eq("plan", "pro")),
    count("omtana_users", (q) => q.gte("created_at", since)),
    count("omtana_api_keys", (q) => q.is("revoked_at", null)),
  ]);

  const { rows: meditations } = await fetchAll<{
    status: string;
    source: string;
    user_id: string | null;
    created_via?: string;
    script_mode?: string | null;
    visibility: string;
  }>((from, to) =>
    db()
      .from("omtana_meditations")
      .select("status, source, user_id, created_via, script_mode, visibility")
      .gte("created_at", since)
      .range(from, to),
  );
  const byStatus = groupSum(meditations, (m) => m.status, () => 1);
  const done = (byStatus.ready ?? 0) + (byStatus.failed ?? 0);

  const { data: active } = await db()
    .from("omtana_generation_jobs")
    .select("id, meditation_id, status, step, error, created_at, started_at")
    .in("status", ["queued", "running"]);
  const activeJobs = (active as JobRow[]) ?? [];

  const { rows: plays } = await fetchAll<{ completed: boolean; seconds_listened: number }>((from, to) =>
    db().from("omtana_plays").select("completed, seconds_listened").gte("created_at", since).range(from, to),
  );
  const { rows: ledger } = await fetchAll<{ delta: number; reason_key: string | null }>((from, to) =>
    db().from("omtana_credit_ledger").select("delta, reason_key").gte("created_at", since).range(from, to),
  );

  let costs: Awaited<ReturnType<typeof costReport>> | null = null;
  try {
    costs = await costReport({ sinceDays: days, groupBy: ["operation"], top: 5 });
  } catch {
    costs = null;
  }

  return {
    period_days: days,
    users: { total: usersTotal, pro: usersPro, new_in_period: usersNew, active_mcp_keys: keysActive },
    meditations: {
      created: meditations.length,
      by_status: byStatus,
      by_source: groupSum(meditations, (m) => m.source, () => 1),
      by_channel: groupSum(meditations, channelOf, () => 1),
      own_script: meditations.filter((m) => m.script_mode).length,
      public: meditations.filter((m) => m.visibility === "public").length,
      failure_rate: done ? Math.round(((byStatus.failed ?? 0) / done) * 1000) / 10 : 0,
    },
    generation_now: {
      queued: activeJobs.filter((j) => j.status === "queued").length,
      running: activeJobs.filter((j) => j.status === "running").length,
      stuck: activeJobs.filter((j) => isStale(j)).map((j) => ({ job: j.id, meditation: j.meditation_id, status: j.status, step: j.step })),
    },
    listening: {
      plays: plays.length,
      completed: plays.filter((p) => p.completed).length,
      hours: Math.round(plays.reduce((n, p) => n + p.seconds_listened, 0) / 360) / 10,
    },
    credits: {
      payments_enabled: paymentsEnabled(),
      bought: ledger.filter((l) => l.reason_key === "credits_purchased").reduce((n, l) => n + l.delta, 0),
      spent: -ledger.filter((l) => l.delta < 0).reduce((n, l) => n + l.delta, 0),
      refunded: ledger.filter((l) => l.reason_key === "refund_failed").reduce((n, l) => n + l.delta, 0),
    },
    costs: costs
      ? {
          total_usd: costs.totals.cost_usd,
          by_provider: costs.by_provider.map((p) => ({ provider: p.key, cost_usd: p.cost_usd })),
          by_operation: costs.groups.operation?.map((o) => ({ operation: o.key, cost_usd: o.cost_usd })),
          avg_per_ready_meditation_usd: costs.per_ready_meditation.avg_cost_usd,
        }
      : { note: "Sin datos de costos: falta la migración 0008 o todavía no hay llamadas registradas." },
  };
}

/* ───────────────────────────── traza ───────────────────────────── */

interface LogRow {
  id: string;
  level: string;
  source: string;
  message: string;
  meditation_id: string | null;
  job_id: string | null;
  user_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export async function meditationTrace(id: string) {
  const { data: meditation } = await db()
    .from("omtana_meditations")
    .select("*, voice:omtana_voices(slug, name), owner:omtana_users(id, email, name, plan)")
    .eq("id", id)
    .maybeSingle();
  if (!meditation) return null;

  const [jobs, logs, usage] = await Promise.all([
    db().from("omtana_generation_jobs").select("*").eq("meditation_id", id).order("created_at"),
    db().from("omtana_logs").select("*").eq("meditation_id", id).order("created_at").limit(500),
    db().from("omtana_usage_events").select("*").eq("meditation_id", id).order("created_at").limit(1000),
  ]);
  const usageRows = (usage.data as UsageRow[]) ?? [];
  const logRows = (logs.data as LogRow[]) ?? [];

  // La plantilla pudo pagarse en otra sesión: se muestra aparte, como contexto.
  let template: Record<string, unknown> | null = null;
  if (meditation.template_id) {
    const { data } = await db()
      .from("omtana_usage_events")
      .select("*")
      .eq("template_id", meditation.template_id)
      .limit(500);
    const rows = (data as UsageRow[]) ?? [];
    template = {
      id: meditation.template_id,
      paid_by_this_meditation: rows.some((r) => r.meditation_id === id),
      ...usageTotals(rows),
    };
  }

  const steps = logRows.filter((l) => l.source === "generation");
  const timeline = steps.map((l, i) => {
    const next = steps[i + 1];
    return {
      at: l.created_at,
      step: (l.data?.step as string) ?? l.message,
      ms: next ? Date.parse(next.created_at) - Date.parse(l.created_at) : null,
    };
  });

  return {
    meditation: {
      id: meditation.id,
      title: meditation.title,
      status: meditation.status,
      source: meditation.source,
      created_via: channelOf(meditation),
      script_mode: meditation.script_mode ?? null,
      locale: meditation.locale,
      duration_seconds: meditation.duration_seconds,
      voice: meditation.voice,
      owner: meditation.owner,
      created_at: meditation.created_at,
      ready_at: meditation.ready_at,
      total_seconds:
        meditation.ready_at ? Math.round((Date.parse(meditation.ready_at) - Date.parse(meditation.created_at)) / 1000) : null,
    },
    jobs: jobs.data ?? [],
    timeline,
    calls: usageRows.map((r) => ({
      at: r.created_at,
      provider: r.provider,
      model: r.model,
      operation: r.operation,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      thinking_tokens: r.thinking_tokens,
      cache_read_tokens: r.cache_read_tokens,
      characters: r.characters,
      cost_usd: r.cost_usd === null ? null : usd(num(r.cost_usd)),
      ms: r.duration_ms,
      request_id: (r.metadata?.request_id as string) ?? null,
    })),
    totals: usageTotals(usageRows),
    by_operation: breakdown(usageRows, (r) => r.operation),
    template,
    other_logs: logRows.filter((l) => l.source !== "generation"),
  };
}

/* ───────────────────────────── errores y bitácora ───────────────────────────── */

export async function errorReport(opts: { sinceHours: number; limit: number }) {
  const since = sinceIso(opts.sinceHours);
  const { data: failed } = await db()
    .from("omtana_generation_jobs")
    .select("id, meditation_id, step, error, created_at, started_at, finished_at, meditation:omtana_meditations(title, user_id, source, created_via, locale, duration_seconds)")
    .eq("status", "failed")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(opts.limit);

  const { data: active } = await db()
    .from("omtana_generation_jobs")
    .select("id, meditation_id, status, step, error, created_at, started_at")
    .in("status", ["queued", "running"]);

  const { data: logs } = await db()
    .from("omtana_logs")
    .select("*")
    .in("level", ["error", "warn"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(opts.limit);

  const failedRows = (failed as unknown as (JobRow & { meditation: unknown })[]) ?? [];
  const patterns = groupSum(
    failedRows,
    (j) => (j.error ?? "sin mensaje").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<id>").slice(0, 140),
    () => 1,
  );

  return {
    since_hours: opts.sinceHours,
    failed_generations: failedRows.length,
    patterns: Object.entries(patterns)
      .sort((a, b) => b[1] - a[1])
      .map(([message, times]) => ({ message, times })),
    failures: failedRows.map((j) => ({
      job: j.id,
      meditation: j.meditation_id,
      step: j.step,
      kind: classifyGenerationError(j.error),
      error: j.error,
      at: j.created_at,
      context: j.meditation,
    })),
    stuck_now: ((active as JobRow[]) ?? []).filter((j) => isStale(j)),
    error_logs: logs ?? [],
  };
}

export async function listLogs(opts: {
  sinceHours: number;
  limit: number;
  levels?: string[];
  source?: string;
  meditationId?: string;
  userId?: string;
  contains?: string;
}) {
  let query = db()
    .from("omtana_logs")
    .select("*")
    .gte("created_at", sinceIso(opts.sinceHours))
    .order("created_at", { ascending: false })
    .limit(opts.limit);
  if (opts.levels?.length) query = query.in("level", opts.levels);
  if (opts.source) query = query.like("source", `${opts.source.replace(/[%_]/g, "")}%`);
  if (opts.meditationId) query = query.eq("meditation_id", opts.meditationId);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  if (opts.contains) query = query.ilike("message", `%${opts.contains.replace(/[%_]/g, "")}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { count: data?.length ?? 0, logs: data ?? [] };
}

/* ───────────────────────────── arquitectura ───────────────────────────── */

const TABLES = [
  "omtana_users",
  "omtana_sessions",
  "omtana_api_keys",
  "omtana_voices",
  "omtana_music_tracks",
  "omtana_intentions",
  "omtana_templates",
  "omtana_template_sections",
  "omtana_meditations",
  "omtana_meditation_segments",
  "omtana_meditation_cues",
  "omtana_breathing_exercises",
  "omtana_breathing_cues",
  "omtana_breathing_renders",
  "omtana_generation_jobs",
  "omtana_plays",
  "omtana_credit_ledger",
  "omtana_video_exports",
  "omtana_publications",
  "omtana_content_proposals",
  "omtana_leads",
  "omtana_usage_events",
  "omtana_logs",
];

const OPTIONAL_ENV = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "ALERT_WEBHOOK_URL",
  "RESEND_API_KEY",
  "ZERNIO_API_KEY",
  "YOUTUBE_REFRESH_TOKEN",
  "OMTANA_ADMIN_MCP_TOKEN",
  "OMTANA_PROMPT_MODEL",
  "ELEVENLABS_USD_PER_1K_CHARS",
  "MCP_ALLOWED_ORIGINS",
  "GENERATION_SECRET",
];

export async function architecture(site: string) {
  const counts = Object.fromEntries(
    await Promise.all(TABLES.map(async (t) => [t, await count(t)] as const)),
  );

  return {
    app: {
      version: APP_VERSION,
      build: BUILD_ID,
      site,
      stack: "Next.js 16 (App Router) en Netlify · Supabase Postgres (sin RLS, service role) · Claude · ElevenLabs · ffmpeg · Stripe",
      generation_runner: generationRunner(),
      plan_version: PLAN_VERSION,
    },
    flow: [
      "1. La web (POST /api/meditations) o un MCP crea la meditación, cobra (cupo Free o crédito) y crea el job en cola.",
      `2. En Netlify el job se despacha firmado (HMAC) a ${BACKGROUND_FUNCTION_PATH}: función en segundo plano, 15 min, ffmpeg empaquetado. En local corre en el mismo proceso.`,
      "3. Plantilla (intención + idioma + duración + voz): bloques fijos escritos y sintetizados una sola vez y reutilizados.",
      "4. Tramo personalizado: Claude lo escribe con el contexto de la persona (o lo trae la persona con guion propio).",
      "5. ElevenLabs sintetiza solo lo nuevo; ffmpeg reparte las pausas, mezcla (con música si se hornea) y sube el MP3 al bucket privado.",
      "6. La respiración es una pista aparte pregrabada; el reproductor la pone antes. El audio sale por URL firmada de 3 h.",
      "7. Si falla: el job queda con el error, sale un aviso (webhook/correo + omtana_logs) y se devuelve lo cobrado. reap-generations barre colgados cada 15 min.",
    ],
    components: [
      { name: "App Next.js", where: "src/app", does: "páginas, sesión propia con cookie, API de generación, reproductor" },
      { name: "MCP usuarios", where: "/api/mcp (src/lib/mcp/user-server.ts)", does: "crear con parámetros, con guion o desde prompt; estado y links. Llave omt_ por persona." },
      { name: "MCP admin", where: "/api/mcp/admin (src/lib/mcp/admin-server.ts)", does: "todo lo anterior para cualquier cuenta + arquitectura, logs, errores, trazas y costos. OMTANA_ADMIN_MCP_TOKEN." },
      { name: "Motor de generación", where: "src/lib/generation", does: "plantillas, guion, voz, mezcla, jobs" },
      { name: "generate-background", where: "netlify/functions", does: "genera en segundo plano con ffmpeg" },
      { name: "generation-health", where: "netlify/functions", does: "mezcla de prueba y variables; corre tras cada deploy" },
      { name: "reap-generations", where: "netlify/functions", does: "da por fallidos los jobs colgados cada 15 min" },
      { name: "Trazas", where: "src/lib/telemetry.ts + src/lib/pricing.ts", does: "tokens, caracteres y costo por llamada; bitácora de pasos, avisos y llamadas MCP" },
      { name: "CLI y GitHub Actions", where: "scripts/ + .github/workflows", does: "banco curado, respiración, video, curaduría, publicación" },
    ],
    models: {
      guion: SCRIPT_MODEL,
      plantilla: TEMPLATE_MODEL,
      curaduria: RESEARCH_MODEL,
      prompt: PROMPT_MODEL,
      voz: TTS_MODEL,
    },
    pricing: {
      as_of: PRICES_AS_OF,
      elevenlabs_usd_per_1k_chars: elevenLabsUsdPer1k(),
      anthropic_usd_per_mtok: Object.fromEntries(knownModels().map((m) => [m, modelPrice(m)])),
    },
    env: {
      required: Object.fromEntries(REQUIRED_ENV.map((k) => [k, Boolean(process.env[k])])),
      optional: Object.fromEntries(OPTIONAL_ENV.map((k) => [k, Boolean(process.env[k])])),
      note: "Solo si están definidas; nunca los valores.",
    },
    alerts: { channels: alertChannels(), also: "omtana_logs (fuente alert)" },
    payments_enabled: paymentsEnabled(),
    limits: {
      mcp_wait_seconds_max: MAX_WAIT_SECONDS,
      mcp_active_generations_per_user: MAX_ACTIVE_PER_USER,
      mcp_prompts_per_user_per_hour: MAX_PROMPTS_PER_HOUR,
      own_script_max_chars: MAX_SCRIPT_CHARS,
    },
    tables: counts,
  };
}

/** ¿Puede este deploy generar? En Netlify pregunta a la función que trae ffmpeg. */
export async function healthCheck(origin: string) {
  if (generationRunner() === "background") {
    const url = new URL("/.netlify/functions/generation-health", origin);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25_000), cache: "no-store" });
      return { where: url.toString(), http: res.status, ...(await res.json()) };
    } catch (err) {
      return { where: url.toString(), ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const { generationHealth } = await import("../generation/health");
  return { where: "en este proceso (runner inline)", ...(await generationHealth()) };
}
