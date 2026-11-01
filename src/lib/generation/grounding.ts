/**
 * ¿El tramo personalizado habla de lo que la persona pidió?
 *
 * Es la razón de ser de una meditación propia, y la que falló: con un prompt
 * que pedía volver el contexto "lugar", el modelo escribía una escena bonita
 * (una puerta, un claro, la luz de la mañana) sin nombrar nunca lo que la
 * persona había contado, y quien escuchaba no se reconocía en nada.
 *
 * El modelo declara sus anclas —los elementos concretos de lo que la persona
 * escribió que el tramo va a nombrar, con sus palabras— y acá se comprueba sin
 * modelo que de verdad estén dichas en el texto, y que alguna suene al
 * comienzo. Si no, se reescribe.
 *
 * Funciones puras, sin dependencias: se prueban en tests/grounding.test.mts.
 */

/** Palabras que no identifican nada aunque tengan cuatro letras o más. */
const STOPWORDS = new Set([
  // es
  "para", "porque", "como", "cuando", "donde", "esta", "este", "esto", "estos", "estas",
  "estoy", "estar", "tengo", "tener", "quiero", "querer", "sobre", "entre", "hacia", "desde",
  "hasta", "pero", "mucho", "mucha", "muchos", "muchas", "poco", "poca", "todo", "toda",
  "todos", "todas", "algo", "nada", "cada", "otra", "otro", "otros", "otras", "mismo",
  "misma", "solo", "sola", "tambien", "siempre", "nunca", "ahora", "luego", "despues",
  "antes", "mejor", "peor", "bien", "hace", "hacer", "puedo", "poder", "quiere", "siento",
  "sentir", "tiene", "tienen", "estan", "ella", "ellos", "ellas", "nuestro", "nuestra",
  "vuestro", "suyo", "suya", "aqui", "alla", "manera", "forma", "cosa", "cosas", "meditacion",
  "sesion",
  // en
  "with", "that", "this", "these", "those", "have", "want", "from", "about", "would", "could",
  "should", "into", "they", "them", "their", "there", "where", "when", "what", "which",
  "while", "very", "more", "much", "some", "something", "feel", "feeling", "need", "make",
  "just", "your", "yours", "been", "being", "really", "meditation", "session",
  // pt
  "porque", "quero", "estou", "muito", "muita", "mais", "menos", "voce", "isso", "isto",
  "esse", "essa", "aquele", "aquela", "sobre", "tenho", "fazer", "pode", "posso", "sempre",
  "agora", "depois", "coisa", "coisas", "sessao", "meditacao",
]);

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

/** Las palabras de un ancla que la identifican: cuatro letras o más y no vacías. */
export function significantWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * Raíz corta para tolerar flexiones: "entrevista"/"entrevistas",
 * "nervioso"/"nerviosa", "trabajo"/"trabajar". Las palabras cortas se
 * comparan enteras para no confundir "lunes" con "luna".
 */
function stem(word: string): string {
  return word.length <= 5 ? word : word.slice(0, Math.max(5, word.length - 2));
}

/** ¿Se dice este ancla en el texto? Basta con una de sus palabras con peso. */
export function anchorIn(anchor: string, text: string): boolean {
  const words = significantWords(anchor);
  if (words.length === 0) return false;
  const spoken = normalize(text).split(" ");
  return words.some((w) => {
    const root = stem(w);
    return spoken.some((s) => (root.length === w.length ? s === w || s.startsWith(w) : s.startsWith(root)));
  });
}

export interface GroundingCheck {
  ok: boolean;
  /** Anclas que sí están dichas. */
  spoken: string[];
  /** Qué falta, en frases que se le pueden devolver al modelo. */
  problems: string[];
}

/** Proporción del comienzo del tramo donde tiene que sonar alguna ancla. */
const OPENING_SHARE = 0.25;
const OPENING_MIN_CHARS = 350;

export function checkGrounding(
  text: string,
  anchors: string[],
  opts: { hasContext: boolean },
): GroundingCheck {
  const unique = [...new Set(anchors.map((a) => a.trim()).filter((a) => significantWords(a).length > 0))];
  const required = opts.hasContext ? 2 : 1;
  const problems: string[] = [];

  if (unique.length < required) {
    problems.push(
      `Faltan anclas: declara al menos ${required} elemento(s) concreto(s) de lo que la persona escribió, con sus palabras.`,
    );
  }

  const spoken = unique.filter((a) => anchorIn(a, text));
  const missing = unique.filter((a) => !spoken.includes(a));
  if (missing.length) {
    problems.push(
      `Estas anclas no se dicen en el tramo: ${missing.map((m) => `"${m}"`).join(", ")}. Cada una tiene que sonar en voz alta.`,
    );
  }

  const openingEnd = Math.max(OPENING_MIN_CHARS, Math.round(text.length * OPENING_SHARE));
  const opening = text.slice(0, openingEnd);
  if (unique.length && !unique.some((a) => anchorIn(a, opening))) {
    problems.push(
      "El comienzo del tramo no dice para qué vino la persona: nómbralo en las primeras dos o tres frases.",
    );
  }

  return { ok: problems.length === 0, spoken, problems };
}
