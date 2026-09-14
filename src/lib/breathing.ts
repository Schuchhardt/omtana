/**
 * Respiración guiada: la estructura de tiempo y las frases.
 *
 * Un ejercicio no es un texto que alguien lee, es una grilla: inhalar cuatro
 * segundos son cuatro segundos de reloj, y la señal del tercero cae en el
 * tercero. De acá salen las tres cosas que tienen que estar de acuerdo — el
 * guion que se sintetiza, el audio que se arma pegando señales en su segundo,
 * y la animación del reproductor — y por eso las calcula una sola función.
 *
 * Módulo puro: lo importan el script de render, el servidor y el cliente.
 */

import type { Translatable } from "./i18n";

export type PhaseKind = "inhale" | "hold" | "exhale" | "empty";
export type CueKind = "lead" | "phase" | "count" | "aside" | "tail";
export type StepKind = PhaseKind | "lead" | "gap" | "tail";

/** Los comentarios que caen entre ciclos: acompañan en vez de solo contar. */
export type AsideKey = "well" | "two" | "last";

/** Frases fijas de un idioma. `sip` es la segunda inhalada del suspiro. */
type PhraseKey = PhaseKind | "sip";

export interface Phase {
  kind: PhaseKind;
  seconds: number;
  /** Qué tan llenos quedan los pulmones al terminar, 0..1. De acá sale el círculo. */
  level?: number;
  /** Frase con la que se anuncia, si no es la que le toca a `kind`. */
  cue?: PhraseKey;
}

export interface BreathingExercise extends Translatable {
  id: string;
  slug: string;
  name: string;
  summary: string;
  phases: Phase[];
  min_cycles: number;
  max_cycles: number;
  /** Cuánto se cuenta: todos los segundos, solo el último de cada fase, o nada. */
  counting: "all" | "last" | "none";
  /** Sonido de aire debajo de la voz, para que se note dónde entra y sale. */
  breath_sounds: boolean;
  lead_in_seconds: number;
  /** Respiro entre ciclos, donde caben los comentarios de acompañamiento. */
  gap_seconds: number;
  /**
   * Mínimo de cierre. Si la frase de despedida dura más, manda ella; si sobra
   * tiempo en el hueco, el cierre lo absorbe hasta `MAX_EXTRA_TAIL_SECONDS`.
   */
  tail_seconds: number;
  sort: number;
  active: boolean;
}

/** Una señal de voz con su segundo exacto dentro del ejercicio. */
export interface BreathingCue {
  at: number;
  kind: CueKind;
  /** Clave en el banco de señales: se sintetiza una vez por voz e idioma. */
  slug: string;
  /** Lo que se oye. Es lo que se muestra al revisar el guion. */
  text: string;
  /**
   * Lo que se le manda a la síntesis, que no siempre es lo mismo.
   *
   * Una palabra suelta en minúscula sale mal: "siete" se oía como "site".
   * Con mayúscula y puntuación la voz la trata como una frase y la pronuncia
   * entera — y la puntuación además cambia la entonación, que es lo que hace
   * que dos tomas del mismo número no suenen calcadas.
   */
  speak: string;
}

/** Un tramo de la animación: el círculo va de `from` a `to` en `seconds`. */
export interface BreathingStep {
  at: number;
  seconds: number;
  kind: StepKind;
  from: number;
  to: number;
  cycle: number;
}

export interface BreathingPlan {
  cycles: number;
  cycleSeconds: number;
  /** Lo que dura de verdad, siempre ≤ el hueco que le dio la sesión. */
  seconds: number;
  cues: BreathingCue[];
  steps: BreathingStep[];
}

/**
 * El hueco que la sesión le reserva a la respiración.
 *
 * Dos minutos es el piso: con uno solo caben dos ciclos de 4-7-8 contando la
 * entrada y el cierre, y el ejercicio se acaba antes de que el cuerpo entre en
 * ritmo. Las sesiones largas se lo pueden permitir más largo.
 */
export function breathingSlotSeconds(durationMinutes: number): number {
  return durationMinutes >= 15 ? 150 : 120;
}

/** Aire extra que puede absorber el cierre antes de devolverle tiempo a la sesión. */
const MAX_EXTRA_TAIL_SECONDS = 8;

/**
 * Respiro mínimo para que quepa un comentario.
 *
 * Cuando el hueco aprieta, el respiro entre ciclos se encoge hasta un segundo,
 * y ahí "la última" ya no cabe: empezaría encima del "inhala" siguiente. En esos
 * casos el respiro se queda en silencio, que igual es lo que hacía falta.
 */
const ASIDE_MIN_GAP_SECONDS = 2;

export function cycleSeconds(exercise: Pick<BreathingExercise, "phases">): number {
  return exercise.phases.reduce((n, p) => n + p.seconds, 0);
}

/**
 * Cuántos ciclos caben en el hueco, dentro de lo que el ejercicio permite.
 *
 * El suspiro fisiológico no mejora con nueve repeticiones y la respiración
 * coherente no sirve con dos, así que cada ejercicio trae su rango y el sobrante
 * se le devuelve a la meditación en vez de estirarse.
 */
export function cyclesForSlot(exercise: BreathingExercise, slotSeconds: number): number | null {
  return (
    fit(exercise, slotSeconds, exercise.lead_in_seconds, exercise.tail_seconds)?.cycles ?? null
  );
}

/**
 * Lo que de verdad duran las partes habladas, cuando ya se grabaron.
 *
 * `lead_in_seconds` y `tail_seconds` son estimaciones: cuánto tarda una voz en
 * decir una frase no se sabe hasta sintetizarla, y cada voz tarda distinto.
 * Quien graba las mide y vuelve a planificar con los números reales, así que la
 * grilla se acomoda sola en vez de depender de que las constantes estén bien.
 */
export interface SpokenLengths {
  lead?: number;
  tail?: number;
}

/**
 * Cuántos ciclos y con cuánto respiro entre ellos caben en el hueco.
 *
 * El respiro entre ciclos es lo primero que se sacrifica cuando el hueco
 * aprieta: en una sesión de cinco minutos el ejercicio entra justo, y es
 * preferible perder la pausa que perder el ejercicio entero.
 */
function fit(
  exercise: BreathingExercise,
  slotSeconds: number,
  leadInSeconds: number,
  tailSeconds: number,
): { cycles: number; gap: number } | null {
  const cycle = cycleSeconds(exercise);
  const room = slotSeconds - leadInSeconds - tailSeconds;

  for (let gap = exercise.gap_seconds ?? 0; gap >= 0; gap--) {
    // Los respiros van entre ciclos, así que hay uno menos que ciclos.
    const fits = Math.floor((room + gap) / (cycle + gap));
    if (fits >= exercise.min_cycles) {
      return { cycles: Math.min(fits, exercise.max_cycles), gap };
    }
  }
  return null;
}

/**
 * Arma el ejercicio completo para una voz de un idioma dentro de un hueco.
 *
 * Devuelve `null` cuando el ejercicio no entra en el hueco: en una sesión de
 * cinco minutos no todos caben, y es preferible no ofrecerlo a ofrecerlo mutilado.
 */
export function planBreathing(
  exercise: BreathingExercise,
  locale: string,
  slotSeconds: number,
  spoken: SpokenLengths = {},
): BreathingPlan | null {
  const leadInSeconds = Math.max(exercise.lead_in_seconds, spoken.lead ?? 0);
  const baseTail = Math.max(exercise.tail_seconds, spoken.tail ?? 0);
  const room = fit(exercise, slotSeconds, leadInSeconds, baseTail);
  if (!room) return null;

  const { cycles, gap } = room;
  const words = phrases(locale);
  const cycle = cycleSeconds(exercise);
  const said = leadInSeconds + cycles * cycle + (cycles - 1) * gap;
  const extraTail = Math.min(
    MAX_EXTRA_TAIL_SECONDS,
    Math.max(0, slotSeconds - said - baseTail),
  );
  const tail = baseTail + extraTail;

  // El preámbulo solo cabe donde hay hueco; con un minuto se va directo al patrón.
  const roomy = slotSeconds >= 120;
  const lead = words.lead(exercise, cycles, roomy);
  const closing = words.tail(roomy);

  const cues: BreathingCue[] = [
    {
      at: 0,
      // Los ciclos van en la clave porque van en la frase: la entrada de dos
      // ciclos y la de cinco son dos grabaciones distintas del mismo ejercicio.
      kind: "lead",
      slug: `lead-${exercise.slug}-${cycles}c${roomy ? "" : "-corta"}`,
      text: lead,
      speak: respell(words, lead),
    },
  ];
  const steps: BreathingStep[] = [
    { at: 0, seconds: leadInSeconds, kind: "lead", from: 0, to: 0, cycle: 0 },
  ];

  let at = leadInSeconds;
  let level = 0;

  for (let cycleIndex = 0; cycleIndex < cycles; cycleIndex++) {
    // La toma rota por ciclo: el mismo número dicho de tres maneras, y dentro
    // de un ciclo todas iguales para que no suene inquieto. Repetir la misma
    // grabación cinco veces seguidas es lo que sonaba a máquina.
    const take = cycleIndex % TAKES.length;

    for (const phase of exercise.phases) {
      const to = phase.level ?? defaultLevel(phase.kind, level);
      const key = phase.cue ?? phase.kind;
      const options = words.phase[key];
      const variant = cycleIndex % options.length;

      cues.push({
        at,
        kind: "phase",
        // La toma va en la clave igual que en los números: sin ella, dos ciclos
        // que caen en la misma variante reutilizaban la misma grabación y la
        // variación se perdía justo donde más se nota.
        slug: `${key}-${variant}-${take}`,
        text: options[variant],
        speak: say(words, options[variant], take),
      });

      // La instrucción ocupa el lugar del uno: "Inhala" es el primer segundo,
      // así que el conteo entra en el segundo siguiente diciendo "dos".
      for (const second of countsFor(exercise.counting, phase.seconds)) {
        const word = words.numbers[second + 1];
        // Una fase más larga que el vocabulario de números se cuenta hasta
        // donde alcanza: el resto del tramo va en silencio, que es mejor que
        // decir un número equivocado.
        if (!word) continue;
        cues.push({
          at: at + second,
          kind: "count",
          slug: `n${second + 1}-${take}`,
          text: word,
          speak: say(words, word, take),
        });
      }

      steps.push({
        at,
        seconds: phase.seconds,
        kind: phase.kind,
        from: level,
        to,
        cycle: cycleIndex + 1,
      });

      at += phase.seconds;
      level = to;
    }

    if (gap > 0 && cycleIndex < cycles - 1) {
      const aside = gap >= ASIDE_MIN_GAP_SECONDS ? asideFor(cycleIndex, cycles) : null;
      if (aside) {
        cues.push({
          at,
          kind: "aside",
          slug: `aside-${aside}`,
          text: words.aside[aside],
          speak: respell(words, words.aside[aside]),
        });
      }
      steps.push({
        at,
        seconds: gap,
        kind: "gap",
        from: level,
        to: level,
        cycle: cycleIndex + 1,
      });
      at += gap;
    }
  }

  cues.push({
    at,
    kind: "tail",
    slug: roomy ? "tail" : "tail-corta",
    text: closing,
    speak: respell(words, closing),
  });
  steps.push({ at, seconds: tail, kind: "tail", from: level, to: 0, cycle: 0 });

  return { cycles, cycleSeconds: cycle, seconds: at + tail, cues, steps };
}

/**
 * En qué segundos de una fase entra el conteo.
 *
 * "last" deja solo el hito del final: "Inhala… cuatro". Entre medio hay
 * silencio, y ese silencio es lo que permite decir cada palabra lento en vez
 * de encajarla en su segundo a la fuerza.
 */
function countsFor(
  counting: BreathingExercise["counting"] = "last",
  seconds: number,
): number[] {
  if (counting === "none" || seconds < 2) return [];
  if (counting === "last") return [seconds - 1];
  return Array.from({ length: seconds - 1 }, (_, i) => i + 1);
}

/**
 * Qué se dice en el respiro después del ciclo `cycleIndex`.
 *
 * Saber cuánto falta es la diferencia entre seguir a alguien y obedecer a un
 * metrónomo. No en todos los respiros: un comentario cada vez cansa igual que
 * el silencio absoluto.
 */
function asideFor(cycleIndex: number, cycles: number): AsideKey | null {
  const remaining = cycles - cycleIndex - 1;
  if (remaining === 1) return "last";
  if (remaining === 2) return "two";
  if (cycleIndex === 0) return "well";
  return null;
}

/** Cómo se le pide una palabra suelta a la síntesis para que suene entera. */
function say(words: Phrases, text: string, take: number): string {
  const spelled = respell(words, text);
  return spelled.charAt(0).toUpperCase() + spelled.slice(1) + TAKES[take];
}

/**
 * Reescribe palabra por palabra lo que la voz lee mal.
 *
 * Va sobre frases enteras y no solo sobre señales sueltas: "inhalas" aparece
 * dentro de la entrada hablada, y ahí sonaba igual de mal que suelta.
 */
function respell(words: Phrases, text: string): string {
  const table = words.pronounce;
  if (!table) return text;
  return text.replace(/\p{L}+/gu, (word) => {
    const fixed = table[word.toLowerCase()];
    if (!fixed) return word;
    return word[0] === word[0].toUpperCase()
      ? fixed.charAt(0).toUpperCase() + fixed.slice(1)
      : fixed;
  });
}

function defaultLevel(kind: PhaseKind, current: number): number {
  if (kind === "inhale") return 1;
  if (kind === "exhale") return 0;
  return current; // hold y empty se quedan donde están
}

/** Dónde vive cada señal en el bucket, para no re-sintetizar lo ya dicho. */
export function cuePath(voiceSlug: string, locale: string, slug: string): string {
  return `breathing/cues/${voiceSlug}/${locale}/${slug}.mp3`;
}

export function renderPath(
  exerciseSlug: string,
  voiceSlug: string,
  locale: string,
  slotSeconds: number,
): string {
  return `breathing/${exerciseSlug}/${voiceSlug}-${locale}-${slotSeconds}s.mp3`;
}

/**
 * La misma grabación sin el soplo de aire.
 *
 * Se guarda aparte porque es la que se puede medir: sobre la mezcla final el
 * fondo continuo borra los silencios que separan una señal de la siguiente.
 */
export function renderVoicePath(
  exerciseSlug: string,
  voiceSlug: string,
  locale: string,
  slotSeconds: number,
): string {
  return `breathing/${exerciseSlug}/${voiceSlug}-${locale}-${slotSeconds}s-voz.mp3`;
}

/* ───────────────────────────── las frases ───────────────────────────── */

interface Phrases {
  /** Varias maneras de pedir lo mismo; se turnan por ciclo. */
  phase: Record<PhraseKey, string[]>;
  /** Índice = el segundo que se cuenta; la posición 0 no se usa. */
  numbers: string[];
  /** Lo que se dice en el respiro entre ciclos. */
  aside: Record<AsideKey, string>;
  /** `roomy` es si hay hueco para un cierre hablado o solo para despedirse. */
  tail: (roomy: boolean) => string;
  /** `roomy` es si hay hueco para un preámbulo o solo para el patrón. */
  lead: (exercise: BreathingExercise, cycles: number, roomy: boolean) => string;
  /**
   * Cómo escribirle una palabra a la síntesis cuando la lee mal.
   *
   * La voz no ve fonemas, ve letras: si un número te suena raro, acá se
   * reescribe sin tocar lo que dice el guion ni lo que se verifica.
   */
  pronounce?: Record<string, string>;
}

/**
 * La puntuación con la que se pide cada toma.
 *
 * Un punto cierra, los suspensivos dejan caer la voz, la coma la deja abierta y
 * el punto y coma la sostiene. Seis tomas y no tres porque con tres, el cuarto
 * ciclo repetía literalmente la grabación del primero — y una repetición exacta
 * es lo único que el oído reconoce como máquina. Las entradas que se repiten
 * igual suenan distintas: cada toma se sintetiza por separado.
 */
const TAKES = [".", "…", ",", ";", ".", "…"];

const ES_NUMBERS = [
  "", "uno", "dos", "tres", "cuatro", "cinco", "seis",
  "siete", "ocho", "nueve", "diez", "once", "doce",
];
const EN_NUMBERS = [
  "", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
];
const PT_NUMBERS = [
  "", "um", "dois", "três", "quatro", "cinco", "seis",
  "sete", "oito", "nove", "dez", "onze", "doze",
];

/**
 * La entrada nombra el patrón antes de empezar.
 *
 * Se arma con las mismas fases que después marca el reloj, así que no puede
 * prometer un ritmo distinto del que viene: si el ejercicio cambia, la frase
 * cambia con él.
 */
function leadSentence(
  numbers: string[],
  verbs: Record<PhraseKey, string>,
  join: string,
  template: (cycles: string, pattern: string, roomy: boolean) => string,
) {
  return (exercise: BreathingExercise, cycles: number, roomy: boolean) => {
    const parts = exercise.phases.map(
      (p) => `${verbs[p.cue ?? p.kind]} ${numbers[p.seconds] ?? p.seconds}`,
    );
    const pattern =
      parts.length > 1
        ? `${parts.slice(0, -1).join(", ")} ${join} ${parts[parts.length - 1]}`
        : parts[0];
    return template(numbers[cycles] ?? String(cycles), pattern, roomy);
  };
}

const PHRASES: Record<string, Phrases> = {
  es: {
    phase: {
      // Con el conteo en el último segundo hay varios segundos entre señal y
      // señal, así que caben frases y no solo palabras. La excepción es `sip`:
      // esa fase dura un segundo y la siguiente señal llega enseguida.
      inhale: ["Inhala", "Inspira", "Toma aire", "Deja entrar el aire"],
      hold: ["Sostén", "Retén", "Mantén", "Sostén el aire"],
      exhale: ["Suelta", "Exhala", "Suelta el aire", "Deja salir el aire"],
      empty: ["Espera", "Quieto", "Sin aire", "Quédate ahí"],
      sip: ["Otra vez", "Más aire"],
    },
    numbers: ES_NUMBERS,
    /*
     * Lo que hay que escribirle distinto a la voz para que suene bien.
     *
     * La hache la lee: "inhala" salía "injala". Y "siete" se le comía el
     * diptongo — sonaba "sete" — hasta escribirlo con la tilde en la sílaba
     * que de todos modos lleva el acento. Ninguna de las dos se puede deducir:
     * salieron de escucharlas con `--pronunciar`.
     */
    pronounce: {
      inhala: "inala",
      inhalas: "inalas",
      exhala: "exala",
      exhalas: "exalas",
      siete: "siéte",
    },
    aside: {
      well: "Vas bien.",
      two: "Quedan dos.",
      last: "La última.",
    },
    tail: (roomy) =>
      roomy
        ? "Ya está. Deja que la respiración vuelva a su ritmo, sin contar y " +
          "sin dirigirla. El cuerpo ya sabe hacerlo solo."
        : "Ya está. Deja que la respiración vuelva a su ritmo.",
    lead: leadSentence(
      ES_NUMBERS,
      {
        inhale: "inhalas",
        hold: "sostienes",
        exhale: "sueltas",
        empty: "esperas",
        sip: "vuelves a inhalar",
      },
      "y",
      (cycles, pattern, roomy) =>
        roomy
          ? `Ponte cómodo y cierra los ojos. ` +
            `Vamos a hacer ${cycles} ciclos: ${pattern}. ` +
            `No fuerces el aire.`
          : `Ponte cómodo y cierra los ojos. Vamos a hacer ${cycles} ciclos: ${pattern}.`,
    ),
  },
  en: {
    phase: {
      inhale: ["Inhale", "Breathe in", "Take the air in", "Let the air in"],
      hold: ["Hold", "Hold it", "Keep it", "Hold the air"],
      exhale: ["Exhale", "Let go", "Let the air out", "Breathe it out"],
      empty: ["Wait", "Stay", "Stay there", "Empty"],
      sip: ["Again", "A bit more"],
    },
    numbers: EN_NUMBERS,
    aside: {
      well: "You are doing well.",
      two: "Two to go.",
      last: "Last one.",
    },
    tail: (roomy) =>
      roomy
        ? "That is it. Let your breathing come back to its own rhythm, with " +
          "no counting and no steering. The body knows how on its own."
        : "That is it. Let your breathing come back to its own rhythm.",
    lead: leadSentence(
      EN_NUMBERS,
      {
        inhale: "breathe in",
        hold: "hold",
        exhale: "let go",
        empty: "wait",
        sip: "top it up",
      },
      "and",
      (cycles, pattern, roomy) =>
        roomy
          ? `Get comfortable and close your eyes. ` +
            `We are doing ${cycles} cycles: ${pattern}. ` +
            `Do not force the air.`
          : `Get comfortable and close your eyes. We are doing ${cycles} cycles: ${pattern}.`,
    ),
  },
  pt: {
    phase: {
      inhale: ["Inspira", "Puxa o ar", "Deixa o ar entrar", "Enche o peito"],
      hold: ["Segura", "Prende", "Mantém", "Segura o ar"],
      exhale: ["Solta", "Expira", "Solta o ar", "Deixa o ar sair"],
      empty: ["Espera", "Fica", "Fica aí", "Sem ar"],
      sip: ["De novo", "Mais um"],
    },
    numbers: PT_NUMBERS,
    aside: {
      well: "Está indo bem.",
      two: "Faltam dois.",
      last: "A última.",
    },
    tail: (roomy) =>
      roomy
        ? "Pronto. Deixa a respiração voltar ao ritmo dela, sem contar e sem " +
          "dirigir. O corpo já sabe sozinho."
        : "Pronto. Deixa a respiração voltar ao ritmo dela.",
    lead: leadSentence(
      PT_NUMBERS,
      {
        inhale: "inspiras",
        hold: "seguras",
        exhale: "soltas",
        empty: "esperas",
        sip: "inspiras de novo",
      },
      "e",
      (cycles, pattern, roomy) =>
        roomy
          ? `Fica confortável e fecha os olhos. ` +
            `Vamos fazer ${cycles} ciclos: ${pattern}. ` +
            `Não força o ar.`
          : `Fica confortável e fecha os olhos. Vamos fazer ${cycles} ciclos: ${pattern}.`,
    ),
  },
};

export function phrases(locale: string): Phrases {
  return PHRASES[locale] ?? PHRASES.es;
}

/** Todo lo que hay que sintetizar para un ejercicio en un idioma. */
export function cueBank(
  exercise: BreathingExercise,
  locale: string,
  slotSeconds: number,
): { slug: string; text: string }[] {
  const plan = planBreathing(exercise, locale, slotSeconds);
  if (!plan) return [];

  const seen = new Map<string, string>();
  for (const cue of plan.cues) if (!seen.has(cue.slug)) seen.set(cue.slug, cue.text);
  return [...seen].map(([slug, text]) => ({ slug, text }));
}
