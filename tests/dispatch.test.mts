import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKGROUND_FUNCTION_PATH,
  SIGNATURE_HEADER,
  dispatchToBackground,
  generationRunner,
  signJob,
  verifyJob,
} from "../src/lib/generation/dispatch";

const KEY = "service-role-de-prueba";
const MED = "5f0c1d2e-0000-4000-8000-000000000001";
const JOB = "5f0c1d2e-0000-4000-8000-000000000002";

describe("generationRunner", () => {
  test("en Netlify (fijado al compilar) va a la función en segundo plano", () => {
    assert.equal(generationRunner(undefined, "background"), "background");
  });

  test("GENERATION_RUNNER en runtime manda sobre lo compilado", () => {
    assert.equal(generationRunner("inline", "background"), "inline");
    assert.equal(generationRunner("BACKGROUND", "inline"), "background");
  });

  test("sin nada, corre en el mismo proceso", () => {
    assert.equal(generationRunner(undefined, undefined), "inline");
    assert.equal(generationRunner("", ""), "inline");
  });
});

describe("firma del encargo", () => {
  test("lo firmado se verifica", () => {
    assert.equal(verifyJob(MED, JOB, signJob(MED, JOB, KEY), KEY), true);
  });

  test("otro job, otra clave o una firma rota no pasan", () => {
    const sig = signJob(MED, JOB, KEY);
    assert.equal(verifyJob(MED, "otro-job", sig, KEY), false);
    assert.equal(verifyJob(MED, JOB, sig, "otra-clave"), false);
    assert.equal(verifyJob(MED, JOB, sig.replace(/^./, sig[0] === "a" ? "b" : "a"), KEY), false);
    assert.equal(verifyJob(MED, JOB, "no-es-hex", KEY), false);
    assert.equal(verifyJob(MED, JOB, null, KEY), false);
  });
});

describe("dispatchToBackground", () => {
  test("llama a la función con el encargo firmado y acepta el 202", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const result = await dispatchToBackground(
      { origin: "https://omtana.com", meditationId: MED, jobId: JOB },
      {
        key: KEY,
        fetch: (async (url: string | URL, init?: RequestInit) => {
          seen = { url: String(url), init: init ?? {} };
          return new Response(null, { status: 202 });
        }) as typeof fetch,
      },
    );
    assert.deepEqual(result, { ok: true });
    assert.ok(seen);
    const { url, init } = seen as { url: string; init: RequestInit };
    assert.equal(url, `https://omtana.com${BACKGROUND_FUNCTION_PATH}`);
    assert.equal(init.method, "POST");
    const headers = init.headers as Record<string, string>;
    assert.equal(verifyJob(MED, JOB, headers[SIGNATURE_HEADER], KEY), true);
    assert.deepEqual(JSON.parse(String(init.body)), { meditationId: MED, jobId: JOB });
  });

  test("si la función no está desplegada lo dice, no queda colgado", async () => {
    const result = await dispatchToBackground(
      { origin: "https://omtana.com", meditationId: MED, jobId: JOB },
      { key: KEY, fetch: (async () => new Response("not found", { status: 404 })) as typeof fetch },
    );
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /404/);
  });

  test("un error de red también vuelve como falla, sin lanzar", async () => {
    const result = await dispatchToBackground(
      { origin: "https://omtana.com", meditationId: MED, jobId: JOB },
      {
        key: KEY,
        fetch: (async () => {
          throw new Error("ECONNREFUSED");
        }) as typeof fetch,
      },
    );
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /ECONNREFUSED/);
  });
});
