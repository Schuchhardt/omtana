import Anthropic from "@anthropic-ai/sdk";
import type { PlannedSection } from "../session-plan";
import { sectionMinutes, wordTarget } from "../session-plan";

const MODEL = "claude-opus-5";

export interface ScriptRequest {
  intention: string;
  context: string;
  locale: string;
  voiceName: string;
  sections: PlannedSection[];
}

export interface ScriptResult {
  title: string;
  /** Texto por posición de sección, solo para las secciones dinámicas. */
  segments: Record<number, string>;
  /** Palabras que aparecen en pantalla y en el video. */
  keywords: string[];
}

const LANGUAGE: Record<string, string> = {
  es: "español neutro",
  en: "English",
  pt: "português do Brasil",
};

const SYSTEM = `Escribes guiones de meditación guiada para Omtana.

Cómo suena una meditación de Omtana:
- Segunda persona, presente, frases cortas. Una idea por frase.
- Sin solemnidad ni vocabulario New Age. Nada de "energías", "universo", "sanación".
- Nunca prometes resultados ni das consejo médico, nutricional ni psicológico.
- Las pausas se marcan con "..." al final de una frase. Úsalas seguido: el silencio es parte del guion.
- Trabajas el contexto literal que la persona entregó, sin repetirlo como una lista ni citarlo entre comillas.
- No saludas ni te despides: el tramo que escribes va intercalado entre bloques que ya existen.
- La sesión abrió con un ejercicio de respiración guiado aparte. No lo repitas ni pidas conteos de respiración.

Si el contexto sugiere una crisis de salud mental, no la abordes: mantén el tramo en respiración y presencia, neutro y breve.`;

const outputSchema = {
  type: "object" as const,
  properties: {
    title: {
      type: "string" as const,
      description:
        "Título corto de la meditación, máximo 60 caracteres. Sin comillas ni la palabra 'meditación'.",
    },
    segments: {
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
    keywords: {
      type: "array" as const,
      description:
        "Entre 4 y 7 palabras sueltas que aparecen en pantalla durante la sesión. Una palabra cada una.",
      items: { type: "string" as const },
    },
  },
  required: ["title", "segments", "keywords"],
  additionalProperties: false,
};

export async function writeScript(req: ScriptRequest): Promise<ScriptResult> {
  const client = new Anthropic();
  const dynamic = req.sections.filter((s) => s.kind === "dynamic");

  const brief = dynamic
    .map(
      (s) =>
        `- Sección ${s.position} ("${s.label}"): ${sectionMinutes(s)} minuto(s), alrededor de ${wordTarget(s)} palabras. ${s.brief}`,
    )
    .join("\n");

  const outline = req.sections
    .map(
      (s) =>
        `  ${s.position}. ${s.label} — ${sectionMinutes(s)} min — ${s.kind === "dynamic" ? "LO ESCRIBES TÚ" : "ya existe, no lo escribas"}`,
    )
    .join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: outputSchema },
    },
    messages: [
      {
        role: "user",
        content: `Idioma del guion: ${LANGUAGE[req.locale] ?? LANGUAGE.es}.
Voz que lo va a leer: ${req.voiceName}.

Intención declarada:
${req.intention}

Contexto de la persona:
${req.context.trim() || "(no entregó contexto; escribe el tramo alrededor de la intención sola)"}

Estructura completa de la sesión:
${outline}

Escribe solo estas secciones:
${brief}

El texto va directo a síntesis de voz: sin encabezados, sin viñetas, sin acotaciones entre paréntesis, sin indicaciones de sonido.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      "El modelo no escribió este guion. Revisa el contexto entregado y vuelve a intentar.",
    );
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("El modelo no devolvió guion.");
  }

  const parsed = JSON.parse(text.text) as {
    title: string;
    segments: { position: number; text: string }[];
    keywords: string[];
  };

  const segments: Record<number, string> = {};
  for (const s of parsed.segments) segments[s.position] = s.text.trim();

  // Toda sección dinámica necesita texto; si el modelo se saltó una, fallamos acá
  // y no a mitad de la síntesis.
  for (const s of dynamic) {
    if (!segments[s.position]) {
      throw new Error(`El guion vino sin la sección ${s.position} ("${s.label}").`);
    }
  }

  return {
    title: parsed.title.trim().slice(0, 80),
    segments,
    keywords: parsed.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 7),
  };
}
