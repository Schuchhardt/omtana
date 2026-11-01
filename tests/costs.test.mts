/**
 * Costos y trazas: la tabla de precios, el cálculo sobre el objeto `usage` de
 * la API (caché, búsquedas, fallbacks) y lo que queda guardado de cada llamada.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  anthropicCost,
  elevenLabsCost,
  elevenLabsUsdPer1k,
  modelPrice,
  normalizeModel,
} from "../src/lib/pricing";
import {
  currentTrace,
  logEvent,
  recordAnthropicUsage,
  recordTtsUsage,
  resetTelemetry,
  withTrace,
} from "../src/lib/telemetry";
import { fakeSupabase, opArgs } from "./helpers/fake-supabase.mjs";
import { env } from "./helpers/env.mjs";

const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

describe("precios", () => {
  test("normaliza prefijos de plataforma y fechas", () => {
    assert.equal(normalizeModel("anthropic.claude-opus-5-5"), "claude-opus-5-5");
    assert.equal(normalizeModel("claude-opus-4-5@20251101"), "claude-opus-4-5");
    assert.equal(normalizeModel("claude-haiku-4-5-20251001"), "claude-haiku-4-5");
    assert.deepEqual(modelPrice("claude-opus-5"), { input: 5, output: 25, cacheRead: 0.5 });
    assert.equal(modelPrice("gpt-cualquiera"), null);
  });

  test("entrada y salida a tarifa del modelo", () => {
    // 1M de entrada a $5 + 200K de salida a $25 = $10
    close(anthropicCost("claude-opus-5", { input_tokens: 1_000_000, output_tokens: 200_000 }), 10);
  });

  test("la caché: escritura 1,25× (5 min) o 2× (1 h), lectura a su tarifa", () => {
    const cost = anthropicCost("claude-opus-5-5", {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_500_000,
      cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 500_000 },
      cache_read_input_tokens: 1_000_000,
    });
    // 1M × 4 × 1,25 + 0,5M × 4 × 2 + 1M × 0,20 = 5 + 4 + 0,2
    close(cost, 9.2);
  });

  test("las búsquedas web suman $10 cada mil", () => {
    close(anthropicCost("claude-opus-5", { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 3 } }), 0.03);
  });

  test("con fallbacks cada vuelta se cobra al modelo que la sirvió", () => {
    const cost = anthropicCost("claude-opus-5-5", {
      input_tokens: 2_000_000,
      output_tokens: 0,
      iterations: [
        { type: "message", model: "claude-opus-5-5", input_tokens: 1_000_000, output_tokens: 0 },
        { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1_000_000, output_tokens: 0 },
      ],
    });
    close(cost, 4 + 5);
  });

  test("un modelo sin precio da null, no un cero que parece real", () => {
    assert.equal(anthropicCost("modelo-nuevo", { input_tokens: 10, output_tokens: 10 }), null);
  });

  test("Haiku 5.5 cambia de tarifa sobre 100K de entrada", () => {
    close(anthropicCost("claude-haiku-5-5", { input_tokens: 50_000, output_tokens: 0 }), 0.005);
    close(anthropicCost("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 0 }), 0.1);
  });

  test("ElevenLabs: por caracter, con el precio del plan en una variable", () => {
    assert.equal(elevenLabsUsdPer1k(env({})), 0.22);
    assert.equal(elevenLabsCost(10_000, env({})), 2.2);
    assert.equal(elevenLabsCost(10_000, env({ ELEVENLABS_USD_PER_1K_CHARS: "0.18" })), 1.8);
    assert.equal(elevenLabsUsdPer1k(env({ ELEVENLABS_USD_PER_1K_CHARS: "no" })), 0.22);
  });
});

describe("trazas", () => {
  test("withTrace anida y el contexto interior manda", async () => {
    await withTrace({ meditationId: "m1", via: "web" }, async () => {
      await withTrace({ jobId: "j1", via: "mcp" }, async () => {
        assert.deepEqual(currentTrace(), { meditationId: "m1", jobId: "j1", via: "mcp" });
      });
      assert.deepEqual(currentTrace(), { meditationId: "m1", via: "web" });
    });
    assert.deepEqual(currentTrace(), {});
  });

  test("una respuesta del modelo queda con tokens, costo y el contexto de la sesión", async () => {
    resetTelemetry();
    const { client, queries } = fakeSupabase(() => ({ data: null, error: null }));
    await withTrace({ meditationId: "m1", jobId: "j1", userId: "u1", via: "mcp" }, () =>
      recordAnthropicUsage(
        {
          operation: "guion",
          requestedModel: "claude-opus-5",
          response: {
            model: "claude-opus-5",
            stop_reason: "end_turn",
            _request_id: "req_1",
            usage: { input_tokens: 1000, output_tokens: 2000, output_tokens_details: { thinking_tokens: 500 } },
          },
        },
        { client },
      ),
    );
    assert.equal(queries.length, 1);
    assert.equal(queries[0].table, "omtana_usage_events");
    const row = opArgs(queries[0], "insert")?.[0] as Record<string, unknown>;
    assert.equal(row.provider, "anthropic");
    assert.equal(row.operation, "guion");
    assert.equal(row.meditation_id, "m1");
    assert.equal(row.job_id, "j1");
    assert.equal(row.user_id, "u1");
    assert.equal(row.via, "mcp");
    assert.equal(row.input_tokens, 1000);
    assert.equal(row.thinking_tokens, 500);
    close(row.cost_usd as number, (1000 * 5 + 2000 * 25) / 1e6);
    assert.equal((row.metadata as Record<string, unknown>).request_id, "req_1");
  });

  test("la voz toma la operación del contexto", async () => {
    resetTelemetry();
    const { client, queries } = fakeSupabase(() => ({ data: null, error: null }));
    await withTrace({ operation: "plantilla:voz", templateId: "t1" }, () =>
      recordTtsUsage({ model: "eleven_multilingual_v2", characters: 1000, voiceId: "v" }, { client, env: env({}) }),
    );
    const row = opArgs(queries[0], "insert")?.[0] as Record<string, unknown>;
    assert.equal(row.provider, "elevenlabs");
    assert.equal(row.operation, "plantilla:voz");
    assert.equal(row.template_id, "t1");
    assert.equal(row.characters, 1000);
    assert.equal(row.cost_usd, 0.22);
  });

  test("si falta la tabla avisa una vez y deja de intentar; nunca lanza", async () => {
    resetTelemetry();
    const warnings: string[] = [];
    const { client, queries } = fakeSupabase(() => ({
      data: null,
      error: { message: 'relation "omtana_logs" does not exist' },
    }));
    const deps = { client, warn: (msg: unknown) => warnings.push(String(msg)) };
    await logEvent({ source: "generation", message: "paso: guion" }, deps);
    await logEvent({ source: "generation", message: "paso: voz" }, deps);
    assert.equal(queries.length, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /0008/);
    resetTelemetry();
  });
});
