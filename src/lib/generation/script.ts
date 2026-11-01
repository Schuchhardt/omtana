import Anthropic from "@anthropic-ai/sdk";
import type { PlannedSection } from "../session-plan";
import { sectionMinutes, wordTarget } from "../session-plan";
import { BECKWITH_LENS, HOUSE_STYLE, LANGUAGE } from "./style";
import { SCRIPT_REFUSED } from "./errors";
import { checkGrounding, type GroundingCheck } from "./grounding";

const MODEL = "claude-opus-5";

/** Lo que suena alrededor del tramo: los bloques de la plantilla, ya grabados. */
export interface SurroundingBlock {
  label: string;
  text: string;
}

export interface ScriptRequest {
  intention: string;
  context: string;
  locale: string;
  voiceName: string;
  sections: PlannedSection[];
  /**
   * El bloque que suena justo antes y el que suena justo después. Sin esto el
   * tramo inventaba su propio lugar y sonaba a otra meditación metida en medio.
   */
  surrounding?: { before?: SurroundingBlock | null; after?: SurroundingBlock | null };
}

export interface ScriptResult {
  title: string;
  /** Texto por posición de sección, solo para las secciones dinámicas. */
  segments: Record<number, string>;
  /** Palabras que aparecen en pantalla y en el video. */
  keywords: string[];
  /** Lo de la persona que el tramo nombra en voz alta, con sus palabras. */
  anchors: string[];
  /** Si el tramo de verdad dice lo que la persona pidió (ver grounding.ts). */
  grounding: GroundingCheck;
  /** Cuántas veces hubo que escribirlo. */
  attempts: number;
}

export const SYSTEM = `Escribes el tramo personalizado de una meditación guiada de Omtana: el único que se escribe para una sola persona, con lo que pidió y lo que contó. El resto de la sesión es una plantilla general para su intención; este tramo es la razón por la que pidió una meditación propia. Si quien escucha no reconoce su situación en lo que dices, el tramo fracasó, por bonito que suene.

${HOUSE_STYLE}

${BECKWITH_LENS}

Lo primero: lo suyo, dicho con claridad.
- Antes de escribir, elige de 2 a 4 anclas: los elementos concretos de lo que la persona escribió —qué quiere, qué le pasa, quién está, dónde, cuándo— con sus mismas palabras (traducidas al idioma del guion si escribió en otro). Van en "anchors" y cada una se dice en voz alta en el tramo, con esas palabras.
- Las primeras dos o tres frases nombran para qué vino hoy, con palabras simples y las suyas: lo que pidió y lo concreto de lo que contó. Sin comillas y sin leer su texto como lista, pero sin disfrazarlo: si dijo "la entrevista del lunes", el tramo dice "la entrevista del lunes", no "un umbral" ni "una puerta".
- Lo suyo vuelve a lo largo de todo el tramo, no solo al principio. La escena y las imágenes acompañan su situación; nunca la reemplazan por una metáfora ni la dejan adivinar.
- No inventes detalles que no contó. Si no contó contexto, el tramo se escribe sobre lo que pidió, nombrado con sus palabras.

Cómo se construye. Una historia corta con cuatro momentos, no una lista:
1. Umbral. Nombra lo que la trajo y ponla en su situación real: el lugar, la hora, la persona o el objeto que mencionó. Si te paso el bloque que suena antes, parte del mismo lugar, con sus mismas palabras, y desde ahí aparece lo suyo.
2. Camino. El peso que la trajo, nombrado con claridad y sin dramatizar. Entran, de a una, dos o tres preguntas de visionado hechas sobre su situación concreta, no en abstracto. Silencio después de cada una.
3. Claro. La visión como escena dentro de su vida real: ella misma en la situación que nombró, viviendo la versión más alta de lo que pidió. Qué ve, qué hace con las manos, quién es ahí. Se queda varias frases mirando.
4. Regreso con algo en la mano. Una imagen-ancla tomada de su situación, nombrada dos veces con las mismas palabras, y una frase corta que dice cuándo volver a verla: el momento concreto que mencionó, si mencionó uno.

Además:
- No saludas ni te despides: el tramo va intercalado entre bloques que ya existen. Si te paso lo que suena antes y después, entra y sale sin costura: continúa el lugar del bloque anterior y deja a la persona lista para el siguiente.
- La sesión abrió con un ejercicio de respiración guiado aparte. No lo repitas ni pidas conteos de respiración.
- Si el contexto sugiere una crisis de salud mental, no la abordes ni la visiones: mantén el tramo en cuerpo y presencia, neutro y breve, sin preguntas de visionado. Igual nombras lo que pidió, con sus palabras.`;

const outputSchema = {
  type: "object" as const,
  properties: {
    // Primero las anclas: el modelo escribe en el orden del esquema, así que
    // decide qué va a nombrar antes de escribir el tramo.
    anchors: {
      type: "array" as const,
      description:
        "De 2 a 4 elementos concretos de lo que la persona escribió (qué pide, qué le pasa, quién, dónde, cuándo), con sus palabras y en el idioma del guion. Cada uno se dice en voz alta en el tramo, con esas mismas palabras. Si no contó contexto, al menos lo que pidió.",
      items: { type: "string" as const },
    },
    title: {
      type: "string" as const,
      description:
        "Título corto de la meditación, máximo 60 caracteres, que diga de qué se trata para esta persona. Sin comillas ni la palabra 'meditación'.",
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
        "Entre 4 y 7 palabras sueltas que aparecen en pantalla durante la sesión, en el idioma del guion. Una palabra cada una, sacadas del tramo: lo de la persona, el lugar, el objeto, la imagen-ancla. No conceptos abstractos.",
      items: { type: "string" as const },
    },
  },
  required: ["anchors", "title", "segments", "keywords"],
  additionalProperties: false,
};

type CreateMessage = (
  params: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Pick<Anthropic.Message, "content" | "stop_reason">>;

/** Lo que se le pide al modelo. Exportado para que los tests vean el prompt entero. */
export function buildPrompt(req: ScriptRequest, feedback: string[] = []): string {
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

  const block = (title: string, b: SurroundingBlock | null | undefined) =>
    b?.text.trim() ? `\n${title} (bloque "${b.label}", ya grabado):\n"""\n${b.text.trim()}\n"""\n` : "";

  const context = req.context.trim();

  return `Idioma del guion: ${LANGUAGE[req.locale] ?? LANGUAGE.es}.
Voz que lo va a leer: ${req.voiceName}.

Lo que la persona pidió:
${req.intention.trim()}

Lo que la persona contó:
${context || "(no contó nada más: el tramo se escribe sobre lo que pidió, nombrado con sus palabras)"}
${block("Lo que suena justo antes de tu tramo", req.surrounding?.before)}${block("Lo que suena justo después de tu tramo", req.surrounding?.after)}
Estructura completa de la sesión:
${outline}

Escribe solo estas secciones:
${brief}

Quien escuche tiene que reconocer su situación en las primeras frases y a lo largo de todo el tramo: lo que pidió y lo que contó, dicho con sus palabras. Cuenta la escena completa dentro de estas palabras: umbral, camino, claro y regreso, con la imagen-ancla nombrada dos veces.

El texto va directo a síntesis de voz: sin encabezados, sin viñetas, sin acotaciones entre paréntesis, sin indicaciones de sonido.${
    feedback.length
      ? `\n\nUna versión anterior de este tramo no sirvió porque no hablaba de lo que la persona pidió:\n${feedback.map((f) => `- ${f}`).join("\n")}\nEscríbelo de nuevo corrigiendo eso.`
      : ""
  }`;
}

const MAX_ATTEMPTS = 2;

export async function writeScript(
  req: ScriptRequest,
  deps: { create?: CreateMessage } = {},
): Promise<ScriptResult> {
  const create: CreateMessage =
    deps.create ?? ((params) => new Anthropic().messages.create(params));
  const dynamic = req.sections.filter((s) => s.kind === "dynamic");
  const hasContext = req.context.trim().length > 0;

  let feedback: string[] = [];
  let last: ScriptResult | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: outputSchema },
      },
      messages: [{ role: "user", content: buildPrompt(req, feedback) }],
    });

    if (response.stop_reason === "refusal") {
      // Texto estable: es el único error que se le muestra a la persona (errors.ts).
      throw new Error(SCRIPT_REFUSED);
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      throw new Error("El modelo no devolvió guion.");
    }

    const parsed = JSON.parse(text.text) as {
      anchors?: string[];
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

    const anchors = (parsed.anchors ?? []).map((a) => a.trim()).filter(Boolean);
    const spokenText = dynamic.map((s) => segments[s.position]).join("\n\n");
    const grounding = checkGrounding(spokenText, anchors, { hasContext });

    last = {
      title: parsed.title.trim().slice(0, 80),
      segments,
      keywords: parsed.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 7),
      anchors,
      grounding,
      attempts: attempt,
    };

    if (grounding.ok) return last;
    feedback = grounding.problems;
  }

  // Dos intentos sin nombrar lo suyo: se usa igual (fallar no le da nada a la
  // persona), y quien llama avisa al equipo con `grounding.problems`.
  return last!;
}
