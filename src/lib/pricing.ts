/**
 * Cuánto cuesta cada llamada a un proveedor, en USD.
 *
 * Es una **estimación** hecha con la lista de precios pública, no la factura:
 * no conoce descuentos por volumen, créditos promocionales ni el plan que
 * tenga la cuenta de ElevenLabs. Sirve para lo que se usa —comparar sesiones,
 * ver qué operación pesa más, notar que algo se disparó— y por eso se guarda
 * el detalle (tokens, caracteres) junto al número: si un precio cambia, el
 * costo se puede recalcular sobre lo medido.
 *
 * Sin dependencias a propósito: lo usan la app, el motor de generación (que
 * corre también en las funciones de Netlify) y los tests.
 */

/** Fecha de la lista de precios de abajo. Va en el informe de costos. */
export const PRICES_AS_OF = "2026-10-06";

export interface ModelPrice {
  /** USD por millón de tokens de entrada sin caché. */
  input: number;
  /** USD por millón de tokens de salida (incluye razonamiento). */
  output: number;
  /** USD por millón de tokens leídos de la caché. */
  cacheRead: number;
}

/**
 * Precios por millón de tokens de la API de Anthropic (primera parte).
 *
 * Escribir en caché cuesta 1,25× la entrada con TTL de 5 minutos y 2× con TTL
 * de una hora; leer cuesta lo que dice `cacheRead` (0,1× en casi todos, menos
 * en Opus 5.5 y Fable 5.1).
 */
const ANTHROPIC: Record<string, ModelPrice> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-mythos-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

/** Haiku 5.5 cobra otra tarifa cuando la entrada pasa de 100K tokens. */
const HAIKU_55_LONG: ModelPrice = { input: 0.5, output: 2.5, cacheRead: 0.05 };
const HAIKU_55_LONG_FROM = 100_000;

/** Búsqueda web del lado del servidor: USD por cada mil búsquedas. */
export const WEB_SEARCH_USD_PER_1K = 10;

/** Los ids pueden venir con prefijo de plataforma o con fecha: se normalizan. */
export function normalizeModel(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^(anthropic\.|us\.anthropic\.|eu\.anthropic\.)/, "")
    .replace(/@.*$/, "")
    .replace(/-\d{8}$/, "")
    .replace(/\[.*\]$/, "");
}

export function modelPrice(model: string): ModelPrice | null {
  return ANTHROPIC[normalizeModel(model)] ?? null;
}

export function knownModels(): string[] {
  return Object.keys(ANTHROPIC);
}

/** Lo que importa del objeto `usage` de una respuesta de Messages. */
export interface AnthropicUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
  output_tokens_details?: { thinking_tokens?: number | null } | null;
  /**
   * Con fallbacks o con un bucle de herramientas del servidor, el desglose por
   * vuelta. Cada entrada puede traer su propio modelo, y ahí está el precio
   * correcto: una vuelta servida por el modelo de respaldo se cobra a su tarifa.
   */
  iterations?: Array<{
    type?: string;
    model?: string | null;
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  }> | null;
}

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function tokensCost(
  model: string,
  t: { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number },
): number | null {
  const base = modelPrice(model);
  if (!base) return null;
  const price =
    normalizeModel(model) === "claude-haiku-5-5" &&
    t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h > HAIKU_55_LONG_FROM
      ? HAIKU_55_LONG
      : base;

  return (
    (t.input * price.input +
      t.output * price.output +
      t.cacheWrite5m * price.input * 1.25 +
      t.cacheWrite1h * price.input * 2 +
      t.cacheRead * price.cacheRead) /
    1_000_000
  );
}

/**
 * Costo estimado de una respuesta de la API de Anthropic. `null` si el modelo
 * no está en la tabla: mejor un hueco visible que un cero que parece real.
 */
export function anthropicCost(model: string, usage: AnthropicUsageLike): number | null {
  const searches = n(usage.server_tool_use?.web_search_requests);
  const searchCost = (searches * WEB_SEARCH_USD_PER_1K) / 1000;

  const perModel = (usage.iterations ?? []).filter((it) => it.model);
  if (perModel.length > 0) {
    let total = 0;
    for (const it of perModel) {
      const cost = tokensCost(it.model!, {
        input: n(it.input_tokens),
        output: n(it.output_tokens),
        // Las vueltas no desglosan el TTL de lo que escribieron: 5 minutos,
        // que es el default y lo que usa este proyecto.
        cacheWrite5m: n(it.cache_creation_input_tokens),
        cacheWrite1h: 0,
        cacheRead: n(it.cache_read_input_tokens),
      });
      if (cost === null) return null;
      total += cost;
    }
    return round(total + searchCost);
  }

  const written = n(usage.cache_creation_input_tokens);
  const oneHour = n(usage.cache_creation?.ephemeral_1h_input_tokens);
  const cost = tokensCost(model, {
    input: n(usage.input_tokens),
    output: n(usage.output_tokens),
    cacheWrite5m: Math.max(0, written - oneHour),
    cacheWrite1h: oneHour,
    cacheRead: n(usage.cache_read_input_tokens),
  });
  return cost === null ? null : round(cost + searchCost);
}

/**
 * ElevenLabs cobra por caracter sintetizado (un crédito por caracter con
 * `eleven_multilingual_v2`). El precio depende del plan de la cuenta, así que
 * se lee de `ELEVENLABS_USD_PER_1K_CHARS`; el default es el del plan Creator
 * (USD 22 por 100.000 caracteres).
 */
export const ELEVENLABS_DEFAULT_USD_PER_1K = 0.22;

export function elevenLabsUsdPer1k(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ELEVENLABS_USD_PER_1K_CHARS);
  return Number.isFinite(raw) && raw >= 0 && env.ELEVENLABS_USD_PER_1K_CHARS?.trim()
    ? raw
    : ELEVENLABS_DEFAULT_USD_PER_1K;
}

export function elevenLabsCost(characters: number, env: NodeJS.ProcessEnv = process.env): number {
  return round((Math.max(0, characters) / 1000) * elevenLabsUsdPer1k(env));
}

function round(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
}
