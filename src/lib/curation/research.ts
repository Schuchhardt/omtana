/**
 * La parte de la curaduría que necesita criterio.
 *
 * `./balance` dice dónde están los huecos; acá se propone con qué llenarlos. Y
 * se propone, no se aplica: una intención nueva cambia la portada y un
 * ejercicio de respiración nuevo lo va a hacer gente con el cuerpo, así que
 * entre el modelo y la base hay una persona.
 *
 * El modelo busca en la web antes de responder. Para las intenciones eso es
 * secundario — lo que importa es que la frase describa una situación en la que
 * alguien se reconozca — pero para la respiración es la condición de entrada:
 * un ejercicio entra al banco con la referencia de dónde salen sus tiempos, y
 * esa referencia queda guardada con la propuesta.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { BalanceReport } from "./balance";

const MODEL = "claude-opus-5";

export interface Evidence {
  title: string;
  url: string;
  finding: string;
}

export interface Proposal {
  kind: "intention" | "breathing";
  slug: string;
  payload: Record<string, unknown>;
  gap: string;
  rationale: string;
  evidence: Evidence[];
}

const SYSTEM = `Curas el banco de contenido de Omtana, una app de meditaciones guiadas en español.

El banco se organiza en tres ejes:
- Área de la vida (category): trabajo, dinero, salud, relaciones, comunidad, practica.
- Necesidad (tag): Dormir, Ansiedad, Foco, Cuerpo, Emoción, Vínculo, Sentido, Hábito, Sin objetivo.
- Forma: duración (5, 10, 15, 20), idioma y el ejercicio de respiración con el que abre.

Cómo se escribe una intención de Omtana:
- El título nombra una situación concreta, no un estado abstracto. "Dormir con las cuentas en la cabeza", no "Paz financiera".
- El resumen es la frase en la que la persona se reconoce, en segunda o tercera persona, sin promesas.
- Nada de vocabulario New Age: ni energías, ni universo, ni sanación, ni chakras.
- Nunca se promete un resultado ni se da consejo médico, psicológico ni nutricional.
- El brief no se muestra: es lo que lee el modelo que escribe el guion. Dice qué trabajar y qué evitar.

Cómo entra un ejercicio de respiración:
- Es una grilla de tiempo: fases con duración en segundos enteros, no prosa.
- Tiene que existir evidencia publicada de su efecto — ensayo controlado, revisión sistemática o fisiología establecida — y la referencia va con la propuesta.
- Los tiempos propuestos tienen que ser los del protocolo estudiado, no una variante inventada.
- Si el ejercicio tiene contraindicaciones conocidas (retenciones largas en embarazo o hipertensión, hiperventilación), se dicen.
- No se propone nada que requiera supervisión presencial ni que induzca hiperventilación deliberada.`;

const proposalSchema = {
  type: "object" as const,
  properties: {
    intentions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          slug: { type: "string" as const, description: "en minúsculas y con guiones" },
          title: { type: "string" as const },
          summary: { type: "string" as const },
          tag: { type: "string" as const },
          category: { type: "string" as const },
          durations: { type: "array" as const, items: { type: "integer" as const } },
          brief: { type: "string" as const },
          title_en: { type: "string" as const },
          tag_en: { type: "string" as const },
          summary_en: { type: "string" as const },
          brief_en: { type: "string" as const },
          gap: { type: "string" as const, description: "el hueco del informe que viene a llenar" },
          rationale: { type: "string" as const },
        },
        required: [
          "slug", "title", "summary", "tag", "category", "durations", "brief",
          "title_en", "tag_en", "summary_en", "brief_en", "gap", "rationale",
        ],
        additionalProperties: false,
      },
    },
    exercises: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          slug: { type: "string" as const },
          name: { type: "string" as const },
          summary: { type: "string" as const },
          phases: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                kind: { type: "string" as const, enum: ["inhale", "hold", "exhale", "empty"] },
                seconds: { type: "integer" as const },
              },
              required: ["kind", "seconds"],
              additionalProperties: false,
            },
          },
          min_cycles: { type: "integer" as const },
          max_cycles: { type: "integer" as const },
          counting: { type: "string" as const, enum: ["all", "last", "none"] },
          name_en: { type: "string" as const },
          summary_en: { type: "string" as const },
          cautions: { type: "string" as const },
          gap: { type: "string" as const },
          rationale: { type: "string" as const },
          evidence: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                title: { type: "string" as const },
                url: { type: "string" as const },
                finding: { type: "string" as const },
              },
              required: ["title", "url", "finding"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "slug", "name", "summary", "phases", "min_cycles", "max_cycles", "counting",
          "name_en", "summary_en", "cautions", "gap", "rationale", "evidence",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["intentions", "exercises"],
  additionalProperties: false,
};

const parsed = z.object({
  intentions: z.array(
    z.object({
      slug: z.string().min(3),
      title: z.string().min(3),
      summary: z.string().min(3),
      tag: z.string().min(1),
      category: z.string().min(1),
      durations: z.array(z.number().int()).min(1),
      brief: z.string().min(10),
      title_en: z.string(),
      tag_en: z.string(),
      summary_en: z.string(),
      brief_en: z.string(),
      gap: z.string(),
      rationale: z.string(),
    }),
  ),
  exercises: z.array(
    z.object({
      slug: z.string().min(3),
      name: z.string().min(2),
      summary: z.string().min(3),
      phases: z
        .array(
          z.object({
            kind: z.enum(["inhale", "hold", "exhale", "empty"]),
            seconds: z.number().int().min(1).max(20),
          }),
        )
        .min(2),
      min_cycles: z.number().int().min(1),
      max_cycles: z.number().int().min(1),
      counting: z.enum(["all", "last", "none"]),
      name_en: z.string(),
      summary_en: z.string(),
      cautions: z.string(),
      gap: z.string(),
      rationale: z.string(),
      evidence: z
        .array(z.object({ title: z.string(), url: z.string(), finding: z.string() }))
        .min(1),
    }),
  ),
});

export interface ResearchOptions {
  /** Cuántas intenciones y cuántos ejercicios pedir como mucho. */
  intentions: number;
  exercises: number;
  onStep?: (step: string) => void;
}

export async function research(
  report: BalanceReport,
  opts: ResearchOptions,
): Promise<Proposal[]> {
  const client = new Anthropic();
  const brief = digest(report, opts);

  /*
   * Dos llamadas y no una. La primera busca y razona con la web abierta; la
   * segunda ordena lo encontrado en el esquema. Separarlas es lo que permite
   * que la búsqueda traiga lo que traiga sin pelearse con el formato, y deja
   * el texto intermedio a la vista cuando una propuesta sale rara.
   */
  opts.onStep?.("investigando");
  const findings = await investigate(client, brief);

  opts.onStep?.("ordenando propuestas");
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: proposalSchema } },
    messages: [
      {
        role: "user",
        content: `${brief}\n\nEsto es lo que encontraste al investigar:\n\n${findings}\n\nDevuelve las propuestas en el esquema. Como mucho ${opts.intentions} intenciones y ${opts.exercises} ejercicios; menos está bien si no hay nada que valga la pena. Cada ejercicio tiene que traer al menos una referencia con URL real de las que consultaste.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("El modelo no quiso responder la investigación. Revisa el informe de entrada.");
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("La investigación no devolvió propuestas.");

  const data = parsed.parse(JSON.parse(text.text));

  return [
    ...data.intentions.map(
      (i): Proposal => ({
        kind: "intention",
        slug: i.slug,
        gap: i.gap,
        rationale: i.rationale,
        evidence: [],
        payload: {
          slug: i.slug,
          title: i.title,
          summary: i.summary,
          tag: i.tag,
          category: i.category,
          durations: i.durations,
          brief: i.brief,
          i18n: {
            en: { title: i.title_en, tag: i.tag_en, summary: i.summary_en, brief: i.brief_en },
          },
        },
      }),
    ),
    ...data.exercises.map(
      (e): Proposal => ({
        kind: "breathing",
        slug: e.slug,
        gap: e.gap,
        rationale: `${e.rationale}${e.cautions ? `\n\nPrecauciones: ${e.cautions}` : ""}`,
        evidence: e.evidence,
        payload: {
          slug: e.slug,
          name: e.name,
          summary: e.summary,
          phases: e.phases,
          min_cycles: e.min_cycles,
          max_cycles: Math.max(e.min_cycles, e.max_cycles),
          counting: e.counting,
          breath_sounds: true,
          lead_in_seconds: 12,
          gap_seconds: 4,
          tail_seconds: 8,
          i18n: { en: { name: e.name_en, summary: e.summary_en } },
        },
      }),
    ),
  ];
}

/**
 * La vuelta con la web abierta.
 *
 * `pause_turn` aparece cuando la búsqueda se alarga: la conversación se
 * devuelve tal cual para que siga desde donde quedó, que es lo que la API
 * espera. Sin esto, una investigación larga vuelve a medias y sin avisar.
 */
async function investigate(client: Anthropic, brief: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${brief}

Investiga antes de proponer:

1. Para los ejercicios de respiración que falten: busca el protocolo tal como se estudió — cuántos segundos dura cada fase, cuántos ciclos, en qué población se midió y qué efecto se observó. Prioriza ensayos controlados y revisiones. Anota la URL de cada fuente que uses.
2. Para las intenciones: mira qué situaciones concretas aparecen en el área que está floja. No busques títulos bonitos; busca la situación que alguien describiría con sus palabras.
3. Descarta lo que no tenga respaldo o lo que sea una variante inventada de un protocolo real.

Escribe lo que encontraste en prosa, con las URLs. Todavía no propongas el formato final.`,
    },
  ];

  for (let turn = 0; turn < 6; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }],
      messages,
    });

    if (response.stop_reason === "refusal") {
      throw new Error("El modelo no quiso investigar esto.");
    }

    if (response.stop_reason !== "pause_turn") {
      return response.content
        .filter((b) => b.type === "text")
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("\n")
        .trim();
    }

    messages.push({ role: "assistant", content: response.content });
  }

  throw new Error("La investigación no terminó después de seis vueltas.");
}

/** El informe, en el poco texto que el modelo necesita para decidir. */
function digest(report: BalanceReport, opts: ResearchOptions): string {
  const areas = report.areas
    .map((a) => `  ${a.key}: ${a.intentions} intenciones, ${a.meditations} sesiones publicadas`)
    .join("\n");
  const needs = report.needs
    .map((n) => `  ${n.key}: ${n.intentions} intenciones, ${n.meditations} sesiones`)
    .join("\n");
  const families = report.breathing.families
    .map((f) => `  ${f.label}: ${f.exercises.length ? f.exercises.join(", ") : "SIN CUBRIR"}`)
    .join("\n");
  const gaps = report.gaps
    .filter((g) => g.kind === "intention" || g.kind === "breathing")
    .slice(0, 12)
    .map((g) => `  - ${g.label}`)
    .join("\n");

  return `Estado del banco de Omtana.

Por área de la vida:
${areas}

Por necesidad:
${needs}

Patrones de respiración cubiertos:
${families}

Huecos que el informe marca como prioritarios:
${gaps || "  (ninguno)"}

Se buscan hasta ${opts.intentions} intenciones nuevas y hasta ${opts.exercises} ejercicios de respiración nuevos que equilibren esto. No repitas nada que ya exista.`;
}
