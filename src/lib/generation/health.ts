import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble, ensureFfmpeg, probeFfmpeg, run, FFMPEG_BIN } from "./audio";
import { alertChannels } from "../alerts";

/**
 * ¿Puede este entorno generar una meditación?
 *
 * No basta con que ffmpeg responda `-version`: el build estático podría venir
 * sin el codificador de MP3 o sin un filtro que usa la mezcla, y eso solo se ve
 * mezclando. Así que la prueba arma una sesión de verdad —dos tramos cortos con
 * pausas, música debajo— con el mismo `assemble` que usa el motor, y mide el
 * resultado. Tarda alrededor de un segundo y no gasta modelo ni voz.
 *
 * La usan la función `generation-health` (a pedido y después de cada deploy) y
 * los tests.
 */

export interface HealthCheck {
  name: "ffmpeg" | "mezcla" | "variables" | "avisos";
  ok: boolean;
  detail: string;
}

export interface HealthReport {
  ok: boolean;
  checks: HealthCheck[];
}

/** Sin estas no se puede generar nada. */
export const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
] as const;

/** Un tono con un silencio en medio: suficiente para que la mezcla reparta pausas. */
async function tone(file: string, seconds: number): Promise<Buffer> {
  await run(FFMPEG_BIN, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`,
    "-af", `volume=enable='between(t,${seconds * 0.4},${seconds * 0.6})':volume=0`,
    "-c:a", "libmp3lame", "-b:a", "64k", "-ar", "44100", "-ac", "1",
    file,
  ]);
  return readFile(file);
}

/**
 * Mezcla una sesión mínima y comprueba que dure lo que tiene que durar.
 * Devuelve el detalle para el informe; lanza si algo no cuadra.
 */
export async function smokeMix(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omtana-salud-"));
  try {
    const voice = await tone(join(dir, "voz.mp3"), 3);
    const music = await tone(join(dir, "musica.mp3"), 2);
    const tail = 1;
    const started = Date.now();
    const result = await assemble(
      [
        { position: 1, audio: voice, targetSeconds: 6 },
        { position: 2, audio: voice, targetSeconds: 4 },
      ],
      music,
      { tailSeconds: tail },
    );
    const expected = 6 + 4 + tail;
    if (Math.abs(result.totalSeconds - expected) > 1) {
      throw new Error(`la sesión de prueba duró ${result.totalSeconds} s y debía durar ${expected} s`);
    }
    if (result.mp3.length < 1_000) {
      throw new Error(`el MP3 de prueba salió vacío (${result.mp3.length} bytes)`);
    }
    return `sesión de prueba de ${result.totalSeconds} s mezclada en ${Date.now() - started} ms`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function generationHealth(env: NodeJS.ProcessEnv = process.env): Promise<HealthReport> {
  const checks: HealthCheck[] = [];

  const { found, tried } = await probeFfmpeg();
  checks.push(
    found
      ? { name: "ffmpeg", ok: true, detail: `${found.path} · ${found.version}` }
      : {
          name: "ffmpeg",
          ok: false,
          detail: `no hay ffmpeg. Se probó: ${tried.map((t) => `${t.path} (${t.error})`).join("; ")}`,
        },
  );

  if (found) {
    try {
      await ensureFfmpeg();
      checks.push({ name: "mezcla", ok: true, detail: await smokeMix() });
    } catch (err) {
      checks.push({
        name: "mezcla",
        ok: false,
        detail: err instanceof Error ? err.message.slice(0, 600) : String(err),
      });
    }
  } else {
    checks.push({ name: "mezcla", ok: false, detail: "no se probó: falta ffmpeg" });
  }

  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  checks.push({
    name: "variables",
    ok: missing.length === 0,
    detail: missing.length ? `faltan ${missing.join(", ")}` : "completas",
  });

  // Informativo: sin canales el aviso igual queda en el log de la función.
  const channels = alertChannels(env);
  checks.push({
    name: "avisos",
    ok: true,
    detail: channels.length
      ? `por ${channels.join(", ")}`
      : "sin canal configurado (ALERT_WEBHOOK_URL o RESEND_API_KEY + ALERT_EMAIL_TO): solo log",
  });

  return { ok: checks.every((c) => c.ok), checks };
}

export function formatHealth(report: HealthReport): string {
  return report.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`).join("\n");
}
