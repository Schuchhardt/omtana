/**
 * Graba la muestra de 12 segundos que suena en el banco de voces.
 *
 *   npm run samples             las que falten
 *   npm run samples -- --all    todas, reemplazando
 */
import "./_bootstrap";
import { log, requireEnv, parseArgs, fatal } from "./_bootstrap";
import { db } from "../src/lib/supabase";
import { ensureBucket, uploadAudio } from "../src/lib/storage";
import { synthesize } from "../src/lib/generation/tts";
import type { Voice } from "../src/lib/types";

const LINES: Record<string, string> = {
  es: "Deja que el aire entre sin apurarlo... Nota el peso de tu cuerpo donde estás apoyado... y suelta el aire despacio.",
  en: "Let the air come in without rushing it... Notice the weight of your body where it rests... and let the breath go, slowly.",
  pt: "Deixe o ar entrar sem pressa... Perceba o peso do seu corpo onde ele se apoia... e solte o ar devagar.",
};

async function main() {
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ELEVENLABS_API_KEY");
  const args = parseArgs();
  const all = args.flags.has("all");

  await ensureBucket();

  const { data } = await db().from("omtana_voices").select("*").eq("active", true).order("sort");
  const voices = ((data as Voice[]) ?? []).filter(
    (v) => v.provider_voice_id && (all || !v.sample_url),
  );

  if (voices.length === 0) {
    log.done("No hay muestras pendientes. Usa --all para rehacerlas.");
    return;
  }

  log.title(`Grabando ${voices.length} muestra${voices.length === 1 ? "" : "s"}`);

  const broken: string[] = [];

  for (const voice of voices) {
    log.step(voice.name);
    const line = LINES[voice.languages[0]] ?? LINES.es;

    try {
    const mp3 = await synthesize({
      voiceId: voice.provider_voice_id!,
      text: line,
      settings: voice.provider_settings,
    });

    const path = await uploadAudio(`samples/${voice.slug}.mp3`, mp3);

    // La muestra es pública: suena en el banco sin sesión iniciada.
    const { data: url } = db().storage.from("omtana-audio").getPublicUrl(path);
    const { data: signed } = await db()
      .storage.from("omtana-audio")
      .createSignedUrl(path, 60 * 60 * 24 * 365);

    await db()
      .from("omtana_voices")
      .update({ sample_url: signed?.signedUrl ?? url.publicUrl })
      .eq("id", voice.id);

      log.ok(`${voice.name} lista`);
    } catch (err) {
      // Una voz caída (deshabilitada por su dueño, sin cuota) no puede frenar al resto.
      broken.push(voice.slug);
      log.fail(`${voice.name} — ${err instanceof Error ? err.message.slice(0, 140) : err}`);
    }
  }

  if (broken.length) {
    log.warn(`Sin muestra: ${broken.join(", ")}`);
    log.info("Reasígnalas con: npm run voices:link -- <slug>=<voice_id>");
  }
  log.done("Muestras arriba.");
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
