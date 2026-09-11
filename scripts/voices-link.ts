/**
 * Enlaza cada voz del banco de Omtana con una voz real de ElevenLabs.
 *
 *   npm run voices:link                  lista las voces disponibles y lo ya enlazado
 *   npm run voices:link -- --auto        asigna automáticamente por orden
 *   npm run voices:link -- aurora=21m00Tcm4TlvDq8ikWAM
 *
 * Sin esto la generación falla: una voz sin provider_voice_id no se puede sintetizar.
 */
import "./_bootstrap";
import { log, requireEnv, parseArgs, fatal } from "./_bootstrap";
import { db } from "../src/lib/supabase";
import { listProviderVoices } from "../src/lib/generation/tts";
import type { Voice } from "../src/lib/types";

async function main() {
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ELEVENLABS_API_KEY");
  const args = parseArgs();

  const { data } = await db().from("omtana_voices").select("*").order("sort");
  const voices = (data as Voice[]) ?? [];
  if (voices.length === 0) fatal("No hay voces en la base. Corre primero: npm run seed");

  const provider = await listProviderVoices();

  /* Asignaciones explícitas: slug=voice_id */
  const explicit = args.positional
    .filter((p) => p.includes("="))
    .map((p) => p.split("=") as [string, string]);

  if (explicit.length > 0) {
    log.title("Enlazando voces");
    for (const [slug, providerId] of explicit) {
      const match = provider.find((p) => p.voice_id === providerId);
      const { error } = await db()
        .from("omtana_voices")
        .update({ provider_voice_id: providerId })
        .eq("slug", slug);

      if (error) log.fail(`${slug}: ${error.message}`);
      else log.ok(`${slug} → ${match?.name ?? providerId}`);
    }
    log.done("Listo.");
    return;
  }

  if (args.flags.has("auto")) {
    log.title("Enlace automático");
    if (provider.length === 0) fatal("Tu cuenta de ElevenLabs no tiene voces.");

    for (const [i, voice] of voices.entries()) {
      const target = provider[i % provider.length];
      const { error } = await db()
        .from("omtana_voices")
        .update({ provider_voice_id: target.voice_id })
        .eq("id", voice.id);

      if (error) log.fail(`${voice.slug}: ${error.message}`);
      else log.ok(`${voice.name.padEnd(8)} → ${target.name}`);
    }

    log.done(
      "Enlazadas por orden. Revisa que el acento calce y reasigna las que no con slug=voice_id.",
    );
    return;
  }

  /* Por defecto: mostrar el estado */
  log.title("Voces de Omtana");
  for (const v of voices) {
    const status = v.provider_voice_id
      ? `→ ${provider.find((p) => p.voice_id === v.provider_voice_id)?.name ?? v.provider_voice_id}`
      : "\x1b[31msin enlazar\x1b[0m";
    log.step(`${v.slug.padEnd(8)} ${v.accent.padEnd(24)} ${status}`);
  }

  log.title("Disponibles en ElevenLabs");
  for (const p of provider) {
    const labels = Object.values(p.labels ?? {}).filter(Boolean).join(", ");
    log.step(`${p.voice_id}  ${p.name.padEnd(16)} ${labels}`);
  }

  console.log(
    `\n  Enlaza con:  npm run voices:link -- aurora=${provider[0]?.voice_id ?? "<voice_id>"}`,
  );
  console.log(`  O todas de una:  npm run voices:link -- --auto\n`);
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
