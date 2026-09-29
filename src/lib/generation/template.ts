import Anthropic from "@anthropic-ai/sdk";
import { db } from "../supabase";
import { uploadAudio } from "../storage";
import { planSession, sectionMinutes, wordTarget, type PlannedSection } from "../session-plan";
import { synthesize } from "./tts";
import { localized } from "../i18n";
import { BECKWITH_LENS, HOUSE_STYLE, LANGUAGE } from "./style";
import type { Intention, Voice } from "../types";

const MODEL = "claude-opus-5";

/**
 * Versión del reparto de secciones.
 *
 * La 1 abría con un bloque de respiración escrito; la 2 lo sacó a una pista
 * aparte, así que todas las posiciones se corrieron en uno; la 3 le dio a esa
 * pista dos minutos en vez de uno, y en las sesiones de cinco eso dejó fuera el
 * bloque de refuerzo; la 4 no movió tiempos: cambió lo que dicen los bloques
 * (escena concreta, visionado al estilo Beckwith, imagen-ancla), y una plantilla
 * de la 3 mezclada con un tramo nuevo sonaría a dos meditaciones distintas. Una
 * plantilla vieja reutilizada en una sesión nueva pondría el audio equivocado
 * en cada tramo, y por eso la versión es parte de su identidad.
 */
export const PLAN_VERSION = 4;

const SYSTEM = `Escribes los bloques fijos de las meditaciones de Omtana.

Estos bloques se pregeneran una vez y se reutilizan para todas las personas que
eligen la misma intención, así que no pueden mencionar ningún dato personal ni
suponer nada del caso de quien escucha. Trabajan la intención en general: la
situación que describe su brief, vivida por cualquiera.

${HOUSE_STYLE}

${BECKWITH_LENS}

Qué hace cada bloque:
- Entrada al cuerpo: la persona llega a un lugar. No es un recorrido corporal genérico: es un sitio concreto elegido para esta intención (una orilla al amanecer, una cocina con la luz de la mañana, un banco bajo un árbol, un cuarto con la ventana abierta), con su luz, su temperatura y sus sonidos. El cuerpo se va apoyando ahí, de los pies a la cabeza, y cada zona que se nombra se ve tocando algo de la escena. Termina con la persona sentada o acostada dentro del lugar, quieta, lista para que el tramo personalizado la lleve más adentro.
- Refuerzo e imágenes: el visionado. Retoma el mismo lugar de la entrada, con las mismas palabras, y lo abre: la persona ve la versión más alta de esta intención como escena que ya está sucediendo. Qué ve, qué hace, quién es ahí. Las preguntas de visionado de a una, con silencio después de cada una. Un gesto de gratitud por lo que ya circula. Se cierra con una imagen-ancla nombrada dos veces.
- Cierre: vuelta gradual. La imagen-ancla se guarda, el cuerpo vuelve a la silla o la cama, entran los sonidos reales de la habitación, los ojos se abren. Sin promesas y sin tarea para mañana. Si la intención es para dormir, no hay vuelta ni ojos: las frases se acortan hasta apagarse.

La sesión abre con un ejercicio de respiración guiado que no escribes tú: va en
una pista aparte, con su propio reloj. Tu primer bloque entra justo después, con
la persona ya respirando lento. No repitas instrucciones de respiración contada
ni anuncies lo que acaba de pasar.

Entre la entrada y el refuerzo va un tramo que se escribe aparte para cada
persona y que no conoces. Tus bloques tienen que encajar antes y después de ese
tramo sin anunciarlo: la entrada deja la escena abierta; el refuerzo la retoma
como si la persona nunca la hubiera dejado.`;

const schema = {
  type: "object" as const,
  properties: {
    sections: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          position: { type: "integer" as const },
          text: { type: "string" as const },
        },
        required: ["position", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["sections"],
  additionalProperties: false,
};

async function writeFixedSections(
  intention: Intention,
  locale: string,
  sections: PlannedSection[],
): Promise<Record<number, string>> {
  const client = new Anthropic();
  const fixed = sections.filter((s) => s.kind === "fixed");

  const brief = fixed
    .map(
      (s) =>
        `- Sección ${s.position} ("${s.label}"): ${sectionMinutes(s)} minuto(s), alrededor de ${wordTarget(s)} palabras. ${s.brief}`,
    )
    .join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 12000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    messages: [
      {
        role: "user",
        content: `Idioma: ${LANGUAGE[locale] ?? LANGUAGE.es}.

Intención de esta plantilla: "${localized(intention, locale, "title")}".
${localized(intention, locale, "brief") || localized(intention, locale, "summary")}

Elige un solo lugar para esta intención y úsalo en todos los bloques, con las
mismas palabras cada vez que aparece.

Escribe estas secciones:
${brief}

El texto va directo a síntesis de voz: sin encabezados, sin viñetas, sin acotaciones entre paréntesis, sin indicaciones de sonido.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`El modelo no escribió la plantilla de "${intention.title}".`);
  }

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("La plantilla vino vacía.");

  const parsed = JSON.parse(block.text) as { sections: { position: number; text: string }[] };
  const out: Record<number, string> = {};
  for (const s of parsed.sections) out[s.position] = s.text.trim();

  for (const s of fixed) {
    if (!out[s.position]) {
      throw new Error(`La plantilla vino sin la sección ${s.position} ("${s.label}").`);
    }
  }
  return out;
}

export interface TemplateSectionRow {
  position: number;
  kind: "fixed" | "dynamic";
  label: string;
  seconds: number;
  script_text: string | null;
  audio_path: string | null;
  brief: string;
}

/**
 * Devuelve la plantilla (intención + idioma + duración + voz), generándola y
 * guardándola la primera vez. Es lo que hace que la segunda meditación de una
 * misma intención cueste solo el tramo personalizado.
 */
export async function ensureTemplate(
  intention: Intention,
  locale: string,
  durationMinutes: number,
  voice: Voice,
  opts: { onStep?: (step: string) => void } = {},
): Promise<{ templateId: string; sections: TemplateSectionRow[] }> {
  const { data: existing } = await db()
    .from("omtana_templates")
    .select("id")
    .eq("intention_id", intention.id)
    .eq("locale", locale)
    .eq("duration_minutes", durationMinutes)
    .eq("voice_id", voice.id)
    .eq("plan_version", PLAN_VERSION)
    .eq("active", true)
    .maybeSingle();

  if (existing) {
    const { data } = await db()
      .from("omtana_template_sections")
      .select("position, kind, label, seconds, script_text, audio_path, brief")
      .eq("template_id", existing.id)
      .order("position");

    const rows = (data as TemplateSectionRow[]) ?? [];
    const ready = rows.length > 0 && rows.every((r) => r.kind === "dynamic" || r.audio_path);
    if (ready) return { templateId: existing.id, sections: rows };

    // Plantilla a medio hacer (una corrida anterior falló): se rehace entera.
    await db().from("omtana_templates").delete().eq("id", existing.id);
  }

  // La plantilla se escribe sobre el reparto sin respiración: los bloques fijos
  // no dependen del ejercicio que se elija, y por eso una sola plantilla sirve
  // para todos ellos.
  const plan = planSession(durationMinutes);

  opts.onStep?.("plantilla:guion");
  const texts = await writeFixedSections(intention, locale, plan);

  const { data: template, error } = await db()
    .from("omtana_templates")
    .insert({
      intention_id: intention.id,
      locale,
      duration_minutes: durationMinutes,
      voice_id: voice.id,
      plan_version: PLAN_VERSION,
    })
    .select("id")
    .single();

  if (error || !template) throw new Error(`No se pudo crear la plantilla: ${error?.message}`);

  const rows: TemplateSectionRow[] = [];
  for (const section of plan) {
    let audioPath: string | null = null;
    let scriptText: string | null = null;

    if (section.kind === "fixed") {
      scriptText = texts[section.position];
      opts.onStep?.(`plantilla:voz:${section.position}`);
      const mp3 = await synthesize({
        voiceId: voice.provider_voice_id ?? "",
        text: scriptText,
        settings: voice.provider_settings,
      });
      audioPath = await uploadAudio(
        `templates/${template.id}/${section.position}-${section.label.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.mp3`,
        mp3,
      );
    }

    rows.push({
      position: section.position,
      kind: section.kind,
      label: section.label,
      seconds: section.seconds,
      script_text: scriptText,
      audio_path: audioPath,
      brief: section.brief,
    });
  }

  const { error: sectionsError } = await db()
    .from("omtana_template_sections")
    .insert(rows.map((r) => ({ ...r, template_id: template.id })));

  if (sectionsError) throw new Error(`No se guardaron las secciones: ${sectionsError.message}`);

  return { templateId: template.id, sections: rows };
}
