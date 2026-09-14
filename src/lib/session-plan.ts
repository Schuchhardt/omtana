import type { SectionKind } from "./types";

export interface PlannedSection {
  position: number;
  kind: SectionKind;
  label: string;
  /** Duración en minutos. */
  minutes: number;
  /** Ritmo al que se lee esta sección. El conteo de la respiración va más lento. */
  wordsPerMinute: number;
  /** Qué debe decir esta sección; guía al modelo cuando kind === "dynamic". */
  brief: string;
}

/**
 * Reparte una meditación en secciones fijas (audio ya pregenerado) más los
 * tramos que se escriben para la persona. Es el mismo reparto que muestra el
 * panel "Tu sesión" al personalizar, así que la vista previa y lo que se
 * genera no pueden separarse.
 *
 * 15 min → 2 + 2 + 4 + 5 + 2.  5 min → 1 + 1 + 1 + 1 + 1.
 */
export function planSession(durationMinutes: number): PlannedSection[] {
  const short = durationMinutes <= 5;
  const fixedOpen = short ? 1 : 2;
  const dynamic = Math.max(1, Math.round(durationMinutes * 0.25));
  const reinforcement = durationMinutes - (fixedOpen * 3 + dynamic);

  const raw: Omit<PlannedSection, "position">[] = [
    {
      kind: "fixed",
      label: "Respiración 4-7-8",
      minutes: fixedOpen,
      wordsPerMinute: COUNTED_WORDS_PER_MINUTE,
      brief:
        "Ciclos de respiración 4-7-8 guiados con conteo, sin contenido temático.",
    },
    {
      kind: "fixed",
      label: "Entrada al cuerpo",
      minutes: fixedOpen,
      wordsPerMinute: WORDS_PER_MINUTE,
      brief: "Recorrido corporal breve y aterrizaje en el presente.",
    },
    {
      kind: "dynamic",
      label: "Tu contexto",
      minutes: dynamic,
      wordsPerMinute: WORDS_PER_MINUTE,
      brief:
        "El tramo escrito para esta persona: toma su intención y su contexto literal y los trabaja en segunda persona.",
    },
    {
      kind: "fixed",
      label: "Refuerzo e imágenes",
      minutes: reinforcement,
      wordsPerMinute: WORDS_PER_MINUTE,
      brief: "Imágenes de refuerzo y repetición de la intención en abstracto.",
    },
    {
      kind: "fixed",
      label: "Cierre",
      minutes: fixedOpen,
      wordsPerMinute: WORDS_PER_MINUTE,
      brief: "Vuelta gradual, apertura de ojos y cierre.",
    },
  ];

  return raw
    .filter((s) => s.minutes > 0)
    .map((s, i) => ({ ...s, position: i }));
}

export function planTotals(sections: PlannedSection[]) {
  const total = sections.reduce((n, s) => n + s.minutes, 0);
  const dynamicMinutes = sections
    .filter((s) => s.kind === "dynamic")
    .reduce((n, s) => n + s.minutes, 0);
  return { total, dynamicMinutes, fixedMinutes: total - dynamicMinutes };
}

/**
 * Ritmo de habla al que se escriben los guiones.
 *
 * Es el ritmo **medido** sobre lo que entrega ElevenLabs con `speed: 0.82`, no
 * un ideal: el guion se escribe para que la voz llene el tramo. Cuando esto
 * estaba en 85, el modelo escribía un 30% de menos y cada bloque terminaba con
 * veinte segundos de silencio pegados al final.
 */
export const WORDS_PER_MINUTE = 115;

/** El conteo de la respiración se lee más lento que la prosa. */
export const COUNTED_WORDS_PER_MINUTE = 95;

export function wordTarget(section: Pick<PlannedSection, "minutes" | "wordsPerMinute">): number {
  return Math.round(section.minutes * section.wordsPerMinute);
}
