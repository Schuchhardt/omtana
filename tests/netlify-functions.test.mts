/**
 * Las funciones de Netlify, empaquetadas como las empaqueta Netlify y
 * corriendo como corren en Lambda.
 *
 * - esbuild, ESM, plataforma node, sin la condición `react-server`: si algo
 *   del motor vuelve a importar "server-only", el bundle revienta al cargar.
 * - `ffmpeg-static` fuera del bundle, como en netlify.toml.
 * - Sin ffmpeg del sistema en el PATH y desde otro directorio: la única forma
 *   de encontrarlo es la que usa producción.
 *
 * Es la prueba de que "No hay ffmpeg en este entorno" no vuelve.
 */
import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { build, type Metafile } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
// Dentro del repo para que el `ffmpeg-static` externo se resuelva desde node_modules.
const OUT = join(ROOT, "node_modules", ".cache", "omtana-tests", "functions");
const FUNCTIONS = ["generate-background", "generation-health", "reap-generations"] as const;

let metafile: Metafile;
let elsewhere: string;
const saved = { cwd: process.cwd(), env: { ...process.env } };

type Bundle = Record<string, unknown> & { default: unknown; config?: Record<string, unknown> };
const load = (name: (typeof FUNCTIONS)[number]) =>
  import(pathToFileURL(join(OUT, `${name}.mjs`)).href) as Promise<Bundle>;

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const result = await build({
    entryPoints: FUNCTIONS.map((name) => join(ROOT, "netlify", "functions", `${name}.mts`)),
    outdir: OUT,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["ffmpeg-static"],
    metafile: true,
    logLevel: "silent",
  });
  metafile = result.metafile;

  // Como en Lambda: sin ffmpeg del sistema, sin FFMPEG_PATH, en otra carpeta.
  elsewhere = await mkdtemp(join(tmpdir(), "omtana-lambda-"));
  process.chdir(elsewhere);
  process.env.PATH = dirname(process.execPath);
  delete process.env.FFMPEG_PATH;
  delete process.env.LAMBDA_TASK_ROOT;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.GENERATION_SECRET;
});

after(async () => {
  process.chdir(saved.cwd);
  process.env = saved.env;
  await rm(elsewhere, { recursive: true, force: true });
});

describe("empaquetado", () => {
  test('ninguna función arrastra "server-only"', () => {
    const offenders = Object.keys(metafile.inputs).filter((p) => p.includes("node_modules/server-only"));
    assert.deepEqual(offenders, [], "el motor no puede importar server-only: revienta fuera de Next");
  });

  test("ffmpeg-static queda fuera del bundle", () => {
    const inlined = Object.keys(metafile.inputs).filter((p) => p.includes("node_modules/ffmpeg-static"));
    assert.deepEqual(inlined, []);
  });
});

describe("generate-background", () => {
  test("se declara en segundo plano", async () => {
    const fn = await load("generate-background");
    assert.equal(typeof fn.default, "function");
    assert.equal(fn.config?.background, true);
  });

  test("rechaza lo que no es un encargo firmado, sin tocar la base", async () => {
    const handler = (await load("generate-background")).default as (req: Request) => Promise<Response>;
    const url = "https://omtana.test/.netlify/functions/generate-background";

    assert.equal((await handler(new Request(url))).status, 405);
    assert.equal((await handler(new Request(url, { method: "POST", body: "{" }))).status, 400);
    const unsigned = new Request(url, {
      method: "POST",
      body: JSON.stringify({ meditationId: "m", jobId: "j" }),
    });
    assert.equal((await handler(unsigned)).status, 401);
  });
});

describe("generation-health", () => {
  test("encuentra el ffmpeg empaquetado y mezcla una sesión de prueba", async () => {
    Object.assign(process.env, {
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "x",
      ANTHROPIC_API_KEY: "x",
      ELEVENLABS_API_KEY: "x",
    });
    const fn = (await load("generation-health")).default as { fetch: () => Promise<Response> };
    const res = await fn.fetch();
    const report = (await res.json()) as { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] };
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));

    assert.equal(byName.ffmpeg.ok, true, byName.ffmpeg.detail);
    assert.match(byName.ffmpeg.detail, /node_modules\/ffmpeg-static\/ffmpeg/);
    assert.equal(byName.mezcla.ok, true, byName.mezcla.detail);
    assert.equal(res.status, 200);
    assert.equal(report.ok, true);
  });

  test("después de un deploy roto, avisa", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const errors = mock.method(console, "error", () => {});
    try {
      const fn = (await load("generation-health")).default as { deploySucceeded: () => Promise<void> };
      await fn.deploySucceeded();
      const logged = errors.mock.calls.map((c) => String(c.arguments[0])).join("\n");
      assert.match(logged, /\[omtana:alerta\].*El deploy nuevo no puede generar meditaciones/);
      assert.match(logged, /faltan ANTHROPIC_API_KEY/);
    } finally {
      errors.mock.restore();
    }
  });
});

describe("reap-generations", () => {
  test("es una función programada", async () => {
    const fn = await load("reap-generations");
    assert.equal(typeof fn.default, "function");
    assert.equal(typeof fn.config?.schedule, "string");
  });
});
