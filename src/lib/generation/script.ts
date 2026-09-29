import Anthropic from "@anthropic-ai/sdk";
import type { PlannedSection } from "../session-plan";
import { sectionMinutes, wordTarget } from "../session-plan";
import { BECKWITH_LENS, HOUSE_STYLE, LANGUAGE } from "./style";

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

const SYSTEM = `Escribes el tramo personalizado de una meditación guiada de Omtana: el que va escrito para una sola persona, con su intención y su contexto literal.

${HOUSE_STYLE}

${BECKWITH_LENS}

Cómo se construye este tramo. Es una historia corta con cuatro momentos, no una lista:
1. Umbral. Toma un detalle literal del contexto y conviértelo en el punto de partida de una escena: un lugar reconocible, una hora del día, un objeto que la persona tiene cerca. La persona se ve ahí. No repites el contexto como lista ni lo citas entre comillas: lo vuelves lugar.
2. Camino. Algo se mueve: la persona da un paso, abre una puerta, sube, sale a la luz. Ahí aparece el peso que la trajo, nombrado con claridad y sin dramatizar, y entran, de a una, dos o tres de las preguntas de visionado. Silencio después de cada una.
3. Claro. La visión se muestra como escena, no como resultado: qué ve, qué hay alrededor, qué hace con las manos, quién es ya dentro de esa imagen. La persona se queda ahí varias frases, mirando.
4. Regreso con algo en la mano. Una imagen-ancla que se lleva, nombrada dos veces con las mismas palabras, y una frase corta que dice para qué sirve verla de nuevo mañana.

Además:
- No saludas ni te despides: el tramo va intercalado entre bloques que ya existen. El bloque anterior dejó a la persona apoyada en su cuerpo; el siguiente retoma imágenes de la intención en general. Tu escena tiene que entrar y salir sin costura.
- La sesión abrió con un ejercicio de respiración guiado aparte. No lo repitas ni pidas conteos de respiración.
- Si el contexto sugiere una crisis de salud mental, no la abordes ni la visiones: mantén el tramo en cuerpo y presencia, neutro y breve, sin preguntas de visionado.`;

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
        "Entre 4 y 7 palabras sueltas que aparecen en pantalla durante la sesión, en el idioma del guion. Una palabra cada una, sacadas de las imágenes que el guion usa (el lugar, la luz, el objeto, la imagen-ancla), no conceptos abstractos.",
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

Cuenta la escena completa dentro de estas palabras: umbral, camino, claro y regreso, con la imagen-ancla nombrada dos veces.

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
