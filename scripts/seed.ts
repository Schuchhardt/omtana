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
const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".wav"];

/**
 * El español va en las columnas base; `i18n` lleva el resto de los idiomas.
 * El nombre no se traduce: es un nombre propio.
 */
const VOICES = [
  { slug: "aurora", name: "Aurora", accent: "Español neutro", gender: "Femenina", tone: "Media", languages: ["es", "en"],
    blurb: "Pausada y templada. Funciona bien para sesiones largas y para dormir.",
    i18n: { en: { accent: "Neutral Spanish", blurb: "Unhurried and even. Works well for long sessions and for falling asleep." } } },
  { slug: "mateo", name: "Mateo", accent: "Español rioplatense", gender: "Masculina", tone: "Grave", languages: ["es"],
    blurb: "Cercano, con silencios largos. El acento se nota y a mucha gente le acomoda.",
    i18n: { en: { accent: "Rioplatense Spanish", blurb: "Close up, with long silences. The accent is noticeable and plenty of people find it comfortable." } } },
  { slug: "lucia", name: "Lucía", accent: "Español de España", gender: "Femenina", tone: "Aguda", languages: ["es"],
    blurb: "Clara y despierta. Buena para enfoque y para meditaciones de cinco minutos.",
    i18n: { en: { accent: "Spanish from Spain", blurb: "Clear and awake. Good for focus and for five-minute meditations." } } },
  { slug: "tomas", name: "Tomás", accent: "Español chileno", gender: "Masculina", tone: "Media", languages: ["es"],
    blurb: "Directo, sin solemnidad. Para quien encuentra artificial el tono de meditación.",
    i18n: { en: { accent: "Chilean Spanish", blurb: "Direct, with no solemnity. For anyone who finds the usual meditation tone artificial." } } },
  { slug: "nora", name: "Nora", accent: "Inglés británico", gender: "Femenina", tone: "Grave", languages: ["en"],
    blurb: "Grave y contenida. La más pedida en las sesiones en inglés.",
    i18n: { en: { accent: "British English", blurb: "Deep and restrained. The most requested voice in the English sessions." } } },
  { slug: "elias", name: "Elías", accent: "Español mexicano", gender: "Masculina", tone: "Grave", languages: ["es", "en"],
    blurb: "Cálido y amplio. Sostiene bien los tramos de respiración.",
    i18n: { en: { accent: "Mexican Spanish", blurb: "Warm and roomy. Holds the breathing passages well." } } },
  { slug: "ines", name: "Inês", accent: "Portugués de Brasil", gender: "Femenina", tone: "Media", languages: ["pt"],
    blurb: "Suave y con ritmo. Recién incorporada al banco.",
    i18n: { en: { accent: "Brazilian Portuguese", blurb: "Soft and rhythmic. Just added to the bank." } } },
  { slug: "ruben", name: "Ruben", accent: "Inglés estadounidense", gender: "Masculina", tone: "Media", languages: ["en"],
    blurb: "Neutro y estable. La opción segura si no sabes por dónde empezar.",
    i18n: { en: { accent: "American English", blurb: "Neutral and steady. The safe pick if you do not know where to start." } } },
];

/**
 * `brief` no se muestra: es lo que lee el modelo al escribir la plantilla. Se
 * traduce igual, porque la plantilla en inglés se escribe mejor desde un brief
 * en inglés que desde uno en español.
 */
const INTENTIONS = [
  { slug: "calmar-la-ansiedad", title: "Calmar la ansiedad", tag: "Popular", category: "animo", durations: [5, 10, 15],
    summary: "Bajar la activación cuando el cuerpo va más rápido que el día.",
    brief: "Reducir la activación fisiológica. Trabajar con la respiración larga, el peso del cuerpo y la distancia con los pensamientos, sin pedirle a la persona que deje de sentir lo que siente.",
    i18n: { en: {
      title: "Calm the anxiety", tag: "Popular",
      summary: "Bring the activation down when the body is moving faster than the day.",
      brief: "Reduce physiological activation. Work with long breathing, the weight of the body and distance from thoughts, without asking the person to stop feeling what they feel." } } },
  { slug: "dormir-sin-dar-vueltas", title: "Dormir sin dar vueltas", tag: "Noche", category: "sueno", durations: [10, 20],
    summary: "Para la cabeza que sigue trabajando cuando el cuerpo ya se acostó.",
    brief: "Preparar el sueño. Ritmo muy lento, frases cada vez más cortas, sin pedir esfuerzo ni concentración. Termina sin despedida: la sesión se disuelve.",
    i18n: { en: {
      title: "Sleep without tossing and turning", tag: "Night",
      summary: "For the head that keeps working once the body has gone to bed.",
      brief: "Prepare for sleep. Very slow pace, sentences getting shorter, asking for no effort or concentration. End with no goodbye: the session dissolves." } } },
  { slug: "enfoque-antes-de-trabajar", title: "Enfoque antes de trabajar", tag: "Mañana", category: "foco", durations: [5, 10],
    summary: "Entrar al día con una sola cosa en la cabeza.",
    brief: "Estrechar la atención a una tarea. Despierta pero sin urgencia; termina con la persona lista para abrir el trabajo, no relajada hasta dormirse.",
    i18n: { en: {
      title: "Focus before work", tag: "Morning",
      summary: "Start the day with one single thing in mind.",
      brief: "Narrow attention down to one task. Awake but without urgency; end with the person ready to open their work, not relaxed to the point of sleep." } } },
  { slug: "mejorar-mi-salud", title: "Mejorar mi salud", tag: "Hábito", category: "habito", durations: [10, 15, 20],
    summary: "Sostener un cambio de hábito cuando ya pasó la motivación inicial.",
    brief: "Sostener una conducta de salud en el tiempo. Nada de metas de peso ni de apariencia, ninguna indicación médica ni nutricional: solo la relación con el hábito.",
    i18n: { en: {
      title: "Improve my health", tag: "Habit",
      summary: "Keep a habit change going once the initial motivation has worn off.",
      brief: "Sustain a health behaviour over time. No weight or appearance goals, no medical or nutritional advice: only the relationship with the habit." } } },
  { slug: "fijar-un-objetivo", title: "Fijar un objetivo", tag: "Hábito", category: "habito", durations: [10, 15],
    summary: "Dejar un objetivo claro y tolerable antes de empezar.",
    brief: "Concretar un objetivo y el primer paso. Trabajar la imagen de la persona haciéndolo, no el resultado.",
    i18n: { en: {
      title: "Set a goal", tag: "Habit",
      summary: "Leave a goal clear and bearable before starting.",
      brief: "Pin down a goal and the first step. Work on the image of the person doing it, not on the outcome." } } },
  { slug: "reparar-una-relacion", title: "Reparar una relación", tag: "Vínculos", category: "vinculos", durations: [15, 20],
    summary: "Antes de una conversación que se viene postergando.",
    brief: "Preparar un vínculo tensionado. Reconocer la propia parte sin culpa, sostener que la otra persona tiene su versión, sin prometer reconciliación.",
    i18n: { en: {
      title: "Repair a relationship", tag: "Relationships",
      summary: "Before a conversation that keeps getting postponed.",
      brief: "Prepare for a strained relationship. Acknowledge one's own part without guilt, hold that the other person has their version, without promising reconciliation." } } },
  { slug: "soltar-el-dia", title: "Soltar el día", tag: "Noche", category: "sueno", durations: [5, 10],
    summary: "Cerrar la jornada sin arrastrarla a la noche.",
    brief: "Cerrar el día. Repasar sin juicio, dejar lo pendiente anotado en algún lugar mental y bajar la activación.",
    i18n: { en: {
      title: "Let the day go", tag: "Night",
      summary: "Close the day without dragging it into the night.",
      brief: "Close the day. Review without judgement, leave what is pending noted somewhere mental, and bring activation down." } } },
  { slug: "gratitud-por-la-manana", title: "Gratitud por la mañana", tag: "Mañana", category: "animo", durations: [5],
    summary: "Cinco minutos para empezar el día en otro registro.",
    brief: "Gratitud concreta y cotidiana, nada abstracto ni cósmico. Cosas pequeñas y cercanas.",
    i18n: { en: {
      title: "Morning gratitude", tag: "Morning",
      summary: "Five minutes to start the day in a different register.",
      brief: "Concrete, everyday gratitude, nothing abstract or cosmic. Small, close-at-hand things." } } },
];


/**
 * Ejercicios de respiración.
 *
 * No son texto: son una grilla de tiempo. `phases` define un ciclo y el resto
 * lo calcula `src/lib/breathing.ts` según el hueco que le dé la sesión. El
 * audio no se genera acá — se pregenera con `npm run respiracion`, que es lo
 * que permite verificarlo antes de que lo escuche nadie.
 */
const BREATHING = [
  {
    slug: "4-7-8",
    name: "4-7-8",
    summary: "Inhalas cuatro, sostienes siete y sueltas ocho. La exhalación larga es la que baja la activación.",
    phases: [
      { kind: "inhale", seconds: 4 },
      { kind: "hold", seconds: 7 },
      { kind: "exhale", seconds: 8 },
    ],
    min_cycles: 2,
    max_cycles: 6,
    counting: "last",
    breath_sounds: true,
    lead_in_seconds: 12,
    gap_seconds: 4,
    tail_seconds: 8,
    i18n: {
      en: {
        summary: "Breathe in for four, hold for seven, let go for eight. The long exhale is what brings the activation down.",
      },
    },
  },
  {
    slug: "caja-4-4-4-4",
    name: "Caja 4-4-4-4",
    summary: "Cuatro tiempos iguales, con los pulmones llenos y vacíos. Simétrico y fácil de seguir la primera vez.",
    phases: [
      { kind: "inhale", seconds: 4 },
      { kind: "hold", seconds: 4 },
      { kind: "exhale", seconds: 4 },
      { kind: "empty", seconds: 4 },
    ],
    min_cycles: 2,
    max_cycles: 8,
    counting: "last",
    breath_sounds: true,
    lead_in_seconds: 13,
    gap_seconds: 4,
    tail_seconds: 8,
    i18n: {
      en: {
        name: "Box 4-4-4-4",
        summary: "Four equal counts, lungs full and lungs empty. Symmetrical and easy to follow the first time.",
      },
    },
  },
  {
    slug: "coherente-5-5",
    name: "Coherente 5-5",
    summary: "Cinco y cinco, sin retenciones. Seis respiraciones por minuto: el patrón que se sostiene sin esfuerzo.",
    phases: [
      { kind: "inhale", seconds: 5 },
      { kind: "exhale", seconds: 5 },
    ],
    min_cycles: 3,
    max_cycles: 12,
    // Sin conteo: a este ritmo la voz contando estorba más de lo que guía.
    counting: "none",
    breath_sounds: true,
    lead_in_seconds: 11,
    gap_seconds: 4,
    tail_seconds: 8,
    i18n: {
      en: {
        name: "Coherent 5-5",
        summary: "Five and five, no holds. Six breaths a minute: the pattern you can hold without effort.",
      },
    },
  },
  {
    slug: "suspiro-fisiologico",
    name: "Suspiro fisiológico",
    summary: "Dos inhalaciones seguidas y una exhalación larga. El más rápido para cortar una activación alta.",
    phases: [
      { kind: "inhale", seconds: 3, level: 0.72 },
      { kind: "inhale", seconds: 1, level: 1, cue: "sip" },
      { kind: "exhale", seconds: 7 },
    ],
    min_cycles: 3,
    // Tope más bajo que el resto: el suspiro es corto por diseño — la dosis
    // habitual son tres a cinco — pero con el hueco en dos minutos se queda muy
    // por debajo, así que llega hasta siete antes de devolverle tiempo a la sesión.
    max_cycles: 7,
    counting: "last",
    breath_sounds: true,
    lead_in_seconds: 13,
    gap_seconds: 4,
    tail_seconds: 8,
    i18n: {
      en: {
        name: "Physiological sigh",
        summary: "Two inhales back to back and one long exhale. The fastest way to cut high activation.",
      },
    },
  },
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

  /* Ejercicios de respiración */
  const { error: breathingError } = await db()
    .from("omtana_breathing_exercises")
    .upsert(
      BREATHING.map((b, i) => ({ ...b, sort: i })),
      { onConflict: "slug", ignoreDuplicates: false },
    );
  if (breathingError) fatal(`Respiración: ${breathingError.message}`);
  log.ok(`${BREATHING.length} ejercicios de respiración`);
  log.info("Falta grabarlos: npm run respiracion -- --voz aurora");

  /* Música: lo que haya en assets/music */
  if (!existsSync(MUSIC_DIR)) {
    log.warn(`No existe ${MUSIC_DIR}/ — sin música de fondo por ahora.`);
    log.info("Deja ahí tus pistas de Suno (.mp3) y vuelve a correr el seed.");
  } else {
    const files = (await readdir(MUSIC_DIR)).filter((f) =>
      AUDIO_EXTENSIONS.includes(extname(f).toLowerCase()),
    );

    if (files.length === 0) {
      log.warn(`${MUSIC_DIR}/ está vacío — sin música de fondo por ahora.`);
    }

    for (const file of files) {
      const title = trackName(file);
      const slug = slugify(title);
      const local = join(MUSIC_DIR, file);
      const path = `music/${slug}.mp3`;

      log.step(`música · ${file}`);
      await uploadAudio(path, await readFile(local));

      const { error } = await db().from("omtana_music_tracks").upsert(
        {
          slug,
          name: titleize(title),
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

  log.done("Banco cargado. Siguiente: npm run voices:link y npm run respiracion");
}

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * El nombre de la pista, sin extensión.
 *
 * Quita las extensiones de audio repetidas: lo que sale de una conversión suele
 * llegar como "pista.wav.mp3", y con un solo `basename` el nombre visible
 * terminaba siendo "Pista.wav".
 */
function trackName(file: string): string {
  let name = file;
  while (AUDIO_EXTENSIONS.includes(extname(name).toLowerCase())) {
    name = basename(name, extname(name));
  }
  return name;
}

function titleize(text: string): string {
  const clean = text.replace(/[-_]+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
