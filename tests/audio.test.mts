/**
 * La mezcla, con el ffmpeg que va a producción.
 *
 * Todo corre contra el binario de `ffmpeg-static`, no contra el del sistema: es
 * el que lleva la función de Netlify, y una versión distinta puede no traer un
 * filtro (`apad=whole_dur`, `silencedetect`, `aevalsrc`) o el codificador de
 * MP3. Si eso pasa, falla acá y no en la primera sesión de alguien.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "./helpers/env.mjs";

const staticFfmpeg = createRequire(import.meta.url)("ffmpeg-static") as string;
process.env.FFMPEG_PATH = staticFfmpeg;

const audio = await import("../src/lib/generation/audio");
const { generationHealth, smokeMix } = await import("../src/lib/generation/health");

let dir: string;

async function tone(name: string, seconds: number, opts: { gapAt?: [number, number] } = {}) {
  const file = join(dir, name);
  const filters = opts.gapAt
    ? ["-af", `volume=enable='between(t,${opts.gapAt[0]},${opts.gapAt[1]})':volume=0`]
    : [];
  await audio.run(audio.FFMPEG_BIN, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`,
    ...filters,
    "-ar", "44100", "-ac", "1",
    file,
  ]);
  return file;
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "omtana-test-audio-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("dónde está ffmpeg", () => {
  test("usa el binario de ffmpeg-static cuando FFMPEG_PATH lo señala", async () => {
    audio.resetFfmpegCache();
    const found = await audio.ensureFfmpeg();
    assert.equal(found.path, staticFfmpeg);
    assert.match(found.version, /^ffmpeg version/);
  });

  test("busca en orden: FFMPEG_PATH, el del sistema, node_modules y la raíz de Lambda", () => {
    const list = audio.ffmpegCandidates(
      env({ FFMPEG_PATH: "/opt/ffmpeg", LAMBDA_TASK_ROOT: "/var/task" }),
      "/app",
    );
    assert.deepEqual(list, [
      "/opt/ffmpeg",
      "ffmpeg",
      "/app/node_modules/ffmpeg-static/ffmpeg",
      "/var/task/node_modules/ffmpeg-static/ffmpeg",
    ]);
  });

  test("sin ffmpeg en el sistema cae en el de node_modules (lo que pasa en Lambda)", async () => {
    const { found, tried } = await audio.probeFfmpeg(["/no/existe/ffmpeg", staticFfmpeg]);
    assert.equal(found?.path, staticFfmpeg);
    assert.equal(tried.length, 1);
    assert.equal(tried[0].path, "/no/existe/ffmpeg");
  });

  test("si no hay ninguno, el error dice qué rutas se probaron", async () => {
    const { found, tried } = await audio.probeFfmpeg(["/no/existe/a", "/no/existe/b"]);
    assert.equal(found, null);
    const err = new audio.FfmpegMissingError(tried);
    assert.match(err.message, /No hay ffmpeg en este entorno/);
    assert.match(err.message, /\/no\/existe\/a/);
    assert.match(err.message, /\/no\/existe\/b/);
    assert.match(err.message, /included_files/);
  });
});

describe("duración sin ffprobe", () => {
  test("lee Duration: del encabezado", () => {
    const stderr = "Input #0, mp3, from 'x.mp3':\n  Duration: 00:01:02.50, start: 0.025057, bitrate: 128 kb/s";
    assert.equal(audio.parseDuration(stderr), 62.5);
  });

  test("sin duración declarada usa el último time=", () => {
    const stderr = "Duration: N/A, bitrate: N/A\nsize=N/A time=00:00:03.20 bitrate=N/A\nsize=N/A time=00:00:07.04 bitrate=N/A";
    assert.equal(audio.parseDuration(stderr), 7.04);
  });

  test("sin nada que leer devuelve 0", () => {
    assert.equal(audio.parseDuration("basura"), 0);
  });

  test("mide WAV y MP3 de verdad", async () => {
    const wav = await tone("medida.wav", 2.5);
    assert.ok(Math.abs((await audio.durationOf(wav)) - 2.5) < 0.05);

    const mp3 = join(dir, "medida.mp3");
    await audio.run(audio.FFMPEG_BIN, ["-y", "-loglevel", "error", "-i", wav, "-c:a", "libmp3lame", "-b:a", "64k", mp3]);
    assert.ok(Math.abs((await audio.durationOf(mp3)) - 2.5) < 0.1);
  });
});

describe("assemble", () => {
  test("estira cada tramo a su objetivo, pone música debajo y respeta la cola", async () => {
    // Voz de 8 s con una pausa en medio: el relleno se reparte ahí (silencedetect).
    const voice = await readFile(await tone("voz.wav", 8, { gapAt: [3.5, 4.5] }));
    const short = await readFile(await tone("corta.wav", 2));
    const music = await readFile(await tone("musica.wav", 3));

    const result = await audio.assemble(
      [
        { position: 2, audio: short, targetSeconds: 5 },
        { position: 1, audio: voice, targetSeconds: 14 },
      ],
      music,
      { tailSeconds: 2 },
    );

    // Ordena por posición aunque lleguen desordenados.
    assert.deepEqual(
      result.segments.map((s) => s.position),
      [1, 2],
    );
    assert.equal(result.segments[0].startOffsetSeconds, 0);
    assert.equal(result.segments[0].seconds, 14);
    assert.equal(result.segments[1].startOffsetSeconds, 14);
    assert.equal(result.segments[1].seconds, 5);
    assert.equal(result.totalSeconds, 21);

    const out = join(dir, "sesion.mp3");
    await import("node:fs/promises").then((fs) => fs.writeFile(out, result.mp3));
    assert.ok(Math.abs((await audio.durationOf(out)) - 21) < 0.3);
  });

  test("nunca recorta la voz: si dura más que el objetivo, el tramo crece", async () => {
    const voice = await readFile(await tone("larga.wav", 6));
    const result = await audio.assemble([{ position: 1, audio: voice, targetSeconds: 3 }], null, {
      tailSeconds: 1,
    });
    assert.equal(result.segments[0].seconds, 6);
    assert.equal(result.totalSeconds, 7);
  });

  test("guion propio: el silencio de [pausa N] va entero al final del bloque, sin repartirse", async () => {
    // Con una pausa interna: si el silencio se repartiera, el bloque mediría
    // lo mismo, pero el corte quedaría en medio. Se mide el arranque del siguiente.
    const voice = await readFile(await tone("guion-a.wav", 4, { gapAt: [1.5, 2.2] }));
    const next = await readFile(await tone("guion-b.wav", 2));
    const result = await audio.assemble(
      [
        { position: 0, audio: voice, targetSeconds: 0, trailingSilenceSeconds: 6 },
        { position: 1, audio: next, targetSeconds: 0, trailingSilenceSeconds: 0 },
      ],
      null,
      { tailSeconds: 1 },
    );
    assert.equal(result.segments[0].seconds, 10);
    assert.equal(result.segments[1].startOffsetSeconds, 10);
    assert.equal(result.segments[1].seconds, 2);
    assert.equal(result.totalSeconds, 13);
  });
});

describe("chequeo de salud", () => {
  test("la mezcla de prueba sale bien con el ffmpeg empaquetado", async () => {
    assert.match(await smokeMix(), /sesión de prueba de 11 s/);
  });

  test("marca qué falta para poder generar", async () => {
    const report = await generationHealth(env({ SUPABASE_URL: "x" }));
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
    assert.equal(byName.ffmpeg.ok, true);
    assert.equal(byName.mezcla.ok, true);
    assert.equal(byName.variables.ok, false);
    assert.match(byName.variables.detail, /ANTHROPIC_API_KEY/);
    assert.equal(report.ok, false);
  });
});
