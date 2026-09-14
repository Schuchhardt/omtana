import Anthropic from "@anthropic-ai/sdk";
import { db } from "../supabase";
import { uploadAudio } from "../storage";
import { planSession, wordTarget, type PlannedSection } from "../session-plan";
import { synthesize } from "./tts";
import type { Intention, Voice } from "../types";

const MODEL = "claude-opus-5";

const LANGUAGE: Record<string, string> = {
  es: "español neutro",
  en: "English",
  pt: "português do Brasil",
};

const SYSTEM = `Escribes los bloques fijos de las meditaciones de Omtana.

Estos bloques se pregeneran una vez y se reutilizan para todas las personas que
eligen la misma intención, así que no pueden mencionar ningún dato personal ni
suponer nada del caso de quien escucha.

Cómo suenan:
- Segunda persona, presente, frases cortas. Una idea por frase.
- Sin solemnidad ni vocabulario New Age. Nada de "energías", "universo", "sanación".
- Nunca prometes resultados ni das consejo médico, nutricional ni psicológico.
- Las pausas se marcan con "..." al final de una frase. Úsalas seguido.
- El bloque de respiración guía el patrón con conteo explícito y lo repite varias veces.`;

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
  breathingPattern: string,
): Promise<Record<number, string>> {
  const client = new Anthropic();
  const fixed = sections.filter((s) => s.kind === "fixed");

  const brief = fixed
    .map(
      (s) =>
        `- Sección ${s.position} ("${s.label}"): ${s.minutes} minuto(s), alrededor de ${wordTarget(s)} palabras. ${s.brief}`,
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
Patrón de respiración de la apertura: ${breathingPattern}.

Intención de esta plantilla: "${intention.title}".
${intention.brief || intention.summary}

Entre la sección de entrada al cuerpo y la de refuerzo va un tramo que se
escribe aparte para cada persona. Tus bloques tienen que encajar antes y después
de ese tramo sin repetirlo y sin anunciarlo.

Escribe estas secciones:
${brief}

El texto va directo a síntesis de voz: sin encabezados, sin viñetas, sin acotaciones entre paréntesis.`,
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

  const plan = planSession(durationMinutes);
  const breathingPattern = "4-7-8";

  opts.onStep?.("plantilla:guion");
  const texts = await writeFixedSections(intention, locale, plan, breathingPattern);

  const { data: template, error } = await db()
    .from("omtana_templates")
    .insert({
      intention_id: intention.id,
      locale,
      duration_minutes: durationMinutes,
      voice_id: voice.id,
      breathing_pattern: breathingPattern,
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
      seconds: section.minutes * 60,
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
