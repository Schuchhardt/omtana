/**
 * Carga el banco curado: voces, intenciones y las pistas de música que
 * encuentre en assets/music. Es idempotente — se puede correr las veces que
 * haga falta sin duplicar nada.
 *
 *   npm run seed
 */
import "./_bootstrap";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { log, requireEnv, fatal } from "./_bootstrap";
import { db } from "../src/lib/supabase";
import { ensureBucket, uploadAudio } from "../src/lib/storage";
import { durationOf } from "../src/lib/generation/audio";

const MUSIC_DIR = "assets/music";

const VOICES = [
  { slug: "aurora", name: "Aurora", accent: "Español neutro", gender: "Femenina", tone: "Media", languages: ["es", "en"], blurb: "Pausada y templada. Funciona bien para sesiones largas y para dormir." },
  { slug: "mateo", name: "Mateo", accent: "Español rioplatense", gender: "Masculina", tone: "Grave", languages: ["es"], blurb: "Cercano, con silencios largos. El acento se nota y a mucha gente le acomoda." },
  { slug: "lucia", name: "Lucía", accent: "Español de España", gender: "Femenina", tone: "Aguda", languages: ["es"], blurb: "Clara y despierta. Buena para enfoque y para meditaciones de cinco minutos." },
  { slug: "tomas", name: "Tomás", accent: "Español chileno", gender: "Masculina", tone: "Media", languages: ["es"], blurb: "Directo, sin solemnidad. Para quien encuentra artificial el tono de meditación." },
  { slug: "nora", name: "Nora", accent: "Inglés británico", gender: "Femenina", tone: "Grave", languages: ["en"], blurb: "Grave y contenida. La más pedida en las sesiones en inglés." },
  { slug: "elias", name: "Elías", accent: "Español mexicano", gender: "Masculina", tone: "Grave", languages: ["es", "en"], blurb: "Cálido y amplio. Sostiene bien los tramos de respiración." },
  { slug: "ines", name: "Inês", accent: "Portugués de Brasil", gender: "Femenina", tone: "Media", languages: ["pt"], blurb: "Suave y con ritmo. Recién incorporada al banco." },
  { slug: "ruben", name: "Ruben", accent: "Inglés estadounidense", gender: "Masculina", tone: "Media", languages: ["en"], blurb: "Neutro y estable. La opción segura si no sabes por dónde empezar." },
];

const INTENTIONS = [
  { slug: "calmar-la-ansiedad", title: "Calmar la ansiedad", tag: "Popular", category: "animo", durations: [5, 10, 15],
    summary: "Bajar la activación cuando el cuerpo va más rápido que el día.",
    brief: "Reducir la activación fisiológica. Trabajar con la respiración larga, el peso del cuerpo y la distancia con los pensamientos, sin pedirle a la persona que deje de sentir lo que siente." },
  { slug: "dormir-sin-dar-vueltas", title: "Dormir sin dar vueltas", tag: "Noche", category: "sueno", durations: [10, 20],
    summary: "Para la cabeza que sigue trabajando cuando el cuerpo ya se acostó.",
    brief: "Preparar el sueño. Ritmo muy lento, frases cada vez más cortas, sin pedir esfuerzo ni concentración. Termina sin despedida: la sesión se disuelve." },
  { slug: "enfoque-antes-de-trabajar", title: "Enfoque antes de trabajar", tag: "Mañana", category: "foco", durations: [5, 10],
    summary: "Entrar al día con una sola cosa en la cabeza.",
    brief: "Estrechar la atención a una tarea. Despierta pero sin urgencia; termina con la persona lista para abrir el trabajo, no relajada hasta dormirse." },
  { slug: "mejorar-mi-salud", title: "Mejorar mi salud", tag: "Hábito", category: "habito", durations: [10, 15, 20],
    summary: "Sostener un cambio de hábito cuando ya pasó la motivación inicial.",
    brief: "Sostener una conducta de salud en el tiempo. Nada de metas de peso ni de apariencia, ninguna indicación médica ni nutricional: solo la relación con el hábito." },
  { slug: "fijar-un-objetivo", title: "Fijar un objetivo", tag: "Hábito", category: "habito", durations: [10, 15],
    summary: "Dejar un objetivo claro y tolerable antes de empezar.",
    brief: "Concretar un objetivo y el primer paso. Trabajar la imagen de la persona haciéndolo, no el resultado." },
  { slug: "reparar-una-relacion", title: "Reparar una relación", tag: "Vínculos", category: "vinculos", durations: [15, 20],
    summary: "Antes de una conversación que se viene postergando.",
    brief: "Preparar un vínculo tensionado. Reconocer la propia parte sin culpa, sostener que la otra persona tiene su versión, sin prometer reconciliación." },
  { slug: "soltar-el-dia", title: "Soltar el día", tag: "Noche", category: "sueno", durations: [5, 10],
    summary: "Cerrar la jornada sin arrastrarla a la noche.",
    brief: "Cerrar el día. Repasar sin juicio, dejar lo pendiente anotado en algún lugar mental y bajar la activación." },
  { slug: "gratitud-por-la-manana", title: "Gratitud por la mañana", tag: "Mañana", category: "animo", durations: [5],
    summary: "Cinco minutos para empezar el día en otro registro.",
    brief: "Gratitud concreta y cotidiana, nada abstracto ni cósmico. Cosas pequeñas y cercanas." },
];

async function main() {
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  log.title("Cargando el banco curado");

  await ensureBucket();
  log.ok(`Bucket de audio listo`);

  /* Voces */
  const { error: voiceError } = await db()
    .from("omtana_voices")
    .upsert(
      VOICES.map((v, i) => ({ ...v, sort: i })),
      { onConflict: "slug", ignoreDuplicates: false },
    );
  if (voiceError) fatal(`Voces: ${voiceError.message}`);
  log.ok(`${VOICES.length} voces`);
  log.info("Falta enlazarlas con ElevenLabs: npm run voices:link");

  /* Intenciones */
  const { error: intentionError } = await db()
    .from("omtana_intentions")
    .upsert(
      INTENTIONS.map((it, i) => ({ ...it, sort: i })),
      { onConflict: "slug", ignoreDuplicates: false },
    );
  if (intentionError) fatal(`Intenciones: ${intentionError.message}`);
  log.ok(`${INTENTIONS.length} intenciones`);

  /* Música: lo que haya en assets/music */
  if (!existsSync(MUSIC_DIR)) {
    log.warn(`No existe ${MUSIC_DIR}/ — sin música de fondo por ahora.`);
    log.info("Deja ahí tus pistas de Suno (.mp3) y vuelve a correr el seed.");
  } else {
    const files = (await readdir(MUSIC_DIR)).filter((f) =>
      [".mp3", ".m4a", ".wav"].includes(extname(f).toLowerCase()),
    );

    if (files.length === 0) {
      log.warn(`${MUSIC_DIR}/ está vacío — sin música de fondo por ahora.`);
    }

    for (const file of files) {
      const slug = slugify(basename(file, extname(file)));
      const local = join(MUSIC_DIR, file);
      const path = `music/${slug}.mp3`;

      log.step(`música · ${file}`);
      await uploadAudio(path, await readFile(local));

      const { error } = await db().from("omtana_music_tracks").upsert(
        {
          slug,
          name: titleize(basename(file, extname(file))),
          mood: "ambiente",
          audio_path: path,
          duration_seconds: Math.round(await durationOf(local)),
        },
        { onConflict: "slug" },
      );
      if (error) fatal(`Música ${file}: ${error.message}`);
    }

    if (files.length) log.ok(`${files.length} pistas de música`);
  }

  log.done("Banco cargado. Siguiente: npm run voices:link");
}

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleize(text: string): string {
  const clean = text.replace(/[-_]+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
