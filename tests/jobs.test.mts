import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  QUEUED_STALE_MS,
  RUNNING_STALE_MS,
  claimJob,
  failGeneration,
  isStale,
  reapStaleJobs,
  staleReason,
  type JobRow,
} from "../src/lib/generation/jobs";
import { SCRIPT_REFUSED, classifyGenerationError } from "../src/lib/generation/errors";
import type { Alert } from "../src/lib/alerts";
import { fakeSupabase, has, opArgs, type Query } from "./helpers/fake-supabase.mjs";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

function recorder() {
  const alerts: Alert[] = [];
  const notify = async (alert: Alert) => {
    alerts.push(alert);
    return { delivered: [], failed: [] };
  };
  return { alerts, notify };
}

const isUpdate = (q: Query) => q.ops.some(([op]) => op === "update");

describe("isStale", () => {
  test("un job en cola tiene seis minutos para arrancar", () => {
    assert.equal(isStale({ status: "queued", created_at: ago(5 * MIN), started_at: null }, NOW), false);
    assert.equal(isStale({ status: "queued", created_at: ago(QUEUED_STALE_MS + 1), started_at: null }, NOW), true);
  });

  test("uno corriendo tiene lo que dura una función en segundo plano, y un minuto más", () => {
    const running = { status: "running" as const, created_at: ago(30 * MIN) };
    assert.equal(isStale({ ...running, started_at: ago(10 * MIN) }, NOW), false);
    assert.equal(isStale({ ...running, started_at: ago(RUNNING_STALE_MS + 1) }, NOW), true);
    // Sin started_at se cuenta desde que se creó.
    assert.equal(isStale({ ...running, started_at: null }, NOW), true);
  });

  test("lo terminado nunca está colgado", () => {
    assert.equal(isStale({ status: "done", created_at: ago(99 * MIN), started_at: null }, NOW), false);
    assert.equal(isStale({ status: "failed", created_at: ago(99 * MIN), started_at: null }, NOW), false);
  });

  test("el motivo dice dónde mirar", () => {
    assert.match(staleReason({ status: "queued", step: null }), /generate-background/);
    assert.match(staleReason({ status: "running", step: "voz:3" }), /"voz:3"/);
  });
});

describe("claimJob", () => {
  test("toma el job solo si sigue en cola", async () => {
    const { client, queries } = fakeSupabase(() => ({ data: [{ id: "job-1" }], error: null }));
    assert.equal(await claimJob("job-1", { client }), true);
    assert.ok(has(queries[0], "eq", "id", "job-1"));
    assert.ok(has(queries[0], "eq", "status", "queued"));
    assert.equal((opArgs(queries[0], "update")?.[0] as { status: string }).status, "running");
  });

  test("un reintento de Netlify no vuelve a correrlo", async () => {
    const { client } = fakeSupabase(() => ({ data: [], error: null }));
    assert.equal(await claimJob("job-1", { client }), false);
  });
});

describe("failGeneration", () => {
  test("marca job y sesión, y avisa con el paso en que se cortó", async () => {
    const { alerts, notify } = recorder();
    const { client, queries } = fakeSupabase((q) =>
      q.table === "omtana_generation_jobs"
        ? { data: [{ step: "mezcla" }], error: null }
        : { data: { duration_seconds: 900, locale: "es", source: "user" }, error: null },
    );

    const failed = await failGeneration(
      { meditationId: "med-1", jobId: "job-1", error: new Error("No hay ffmpeg en este entorno.") },
      { client, notify },
    );

    assert.equal(failed, true);
    const job = queries.find((q) => q.table === "omtana_generation_jobs")!;
    assert.ok(has(job, "in", "status", ["queued", "running"]), "solo toca jobs activos");
    assert.deepEqual(
      { ...(opArgs(job, "update")?.[0] as object), finished_at: "x" },
      { status: "failed", error: "No hay ffmpeg en este entorno.", finished_at: "x" },
    );
    const meditation = queries.find((q) => q.table === "omtana_meditations")!;
    assert.deepEqual(opArgs(meditation, "update")?.[0], { status: "failed" });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].title, "Falló la generación de una meditación");
    assert.match(alerts[0].detail ?? "", /No hay ffmpeg/);
    assert.equal(alerts[0].fields?.paso, "mezcla");
    assert.equal(alerts[0].fields?.duración, "15 min");
  });

  test("si el job ya estaba cerrado no marca ni avisa dos veces", async () => {
    const { alerts, notify } = recorder();
    const { client, queries } = fakeSupabase(() => ({ data: [], error: null }));
    const failed = await failGeneration(
      { meditationId: "med-1", jobId: "job-1", error: "otra vez" },
      { client, notify },
    );
    assert.equal(failed, false);
    assert.equal(alerts.length, 0);
    assert.equal(queries.filter((q) => q.table === "omtana_meditations").length, 0);
  });

  test("sin job (no se pudo crear) igual marca la sesión y avisa", async () => {
    const { alerts, notify } = recorder();
    const { client, queries } = fakeSupabase(() => ({ data: null, error: null }));
    await failGeneration({ meditationId: "med-1", jobId: null, error: "insert falló" }, { client, notify });
    assert.equal(queries.length, 1);
    assert.equal(queries[0].table, "omtana_meditations");
    assert.equal(alerts.length, 1);
  });

  test("si la base falla, el aviso sale igual y lo cuenta", async () => {
    const { alerts, notify } = recorder();
    const { client } = fakeSupabase(() => ({ data: null, error: { message: "timeout de Postgres" } }));
    await failGeneration({ meditationId: "med-1", jobId: "job-1", error: "boom" }, { client, notify });
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].detail ?? "", /boom/);
    assert.match(alerts[0].detail ?? "", /timeout de Postgres/);
  });

  test("un rechazo del modelo se avisa como tal", async () => {
    const { alerts, notify } = recorder();
    const { client } = fakeSupabase((q) =>
      q.table === "omtana_generation_jobs" ? { data: [{ step: "guion" }], error: null } : { data: null, error: null },
    );
    await failGeneration({ meditationId: "m", jobId: "j", error: new Error(SCRIPT_REFUSED) }, { client, notify });
    assert.equal(alerts[0].title, "El modelo se negó a escribir un guion");
  });
});

describe("reapStaleJobs", () => {
  test("da por fallidos solo los colgados y avisa por cada uno", async () => {
    const { alerts, notify } = recorder();
    const rows: JobRow[] = [
      { id: "cola-vieja", meditation_id: "m1", status: "queued", step: "script", error: null, created_at: ago(20 * MIN), started_at: null },
      { id: "corriendo-bien", meditation_id: "m2", status: "running", step: "voz:3", error: null, created_at: ago(9 * MIN), started_at: ago(8 * MIN) },
      { id: "corriendo-muerto", meditation_id: "m3", status: "running", step: "guion", error: null, created_at: ago(40 * MIN), started_at: ago(39 * MIN) },
    ];
    const { client, queries } = fakeSupabase((q) => {
      if (q.table === "omtana_generation_jobs" && !isUpdate(q)) return { data: rows, error: null };
      if (q.table === "omtana_generation_jobs") return { data: [{ step: "x" }], error: null };
      return { data: null, error: null };
    });

    const reaped = await reapStaleJobs({ client, notify, now: () => NOW });

    assert.deepEqual(
      reaped.map((j) => j.id),
      ["cola-vieja", "corriendo-muerto"],
    );
    assert.equal(alerts.length, 2);
    const read = queries[0];
    assert.ok(has(read, "in", "status", ["queued", "running"]));
    assert.ok(has(read, "lt", "created_at", ago(QUEUED_STALE_MS)));
  });
});

describe("qué ve la persona", () => {
  test("solo el rechazo del modelo es suyo; lo demás es nuestro", () => {
    assert.equal(classifyGenerationError(SCRIPT_REFUSED), "refused");
    assert.equal(classifyGenerationError("No hay ffmpeg en este entorno."), "internal");
    assert.equal(classifyGenerationError(null), "internal");
  });
});
