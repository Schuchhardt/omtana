import type { SectionKind } from "./types";

export interface PlannedSection {
  position: number;
  kind: SectionKind;
  label: string;
  /** Duración en minutos. */
  minutes: number;
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
      brief:
        "Ciclos de respiración 4-7-8 guiados con conteo, sin contenido temático.",
    },
    {
      kind: "fixed",
      label: "Entrada al cuerpo",
      minutes: fixedOpen,
      brief: "Recorrido corporal breve y aterrizaje en el presente.",
    },
    {
      kind: "dynamic",
      label: "Tu contexto",
      minutes: dynamic,
      brief:
        "El tramo escrito para esta persona: toma su intención y su contexto literal y los trabaja en segunda persona.",
    },
    {
      kind: "fixed",
      label: "Refuerzo e imágenes",
      minutes: reinforcement,
      brief: "Imágenes de refuerzo y repetición de la intención en abstracto.",
    },
    {
      kind: "fixed",
      label: "Cierre",
      minutes: fixedOpen,
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

/** Ritmo de habla al que se escriben los guiones: lento, con pausas. */
export const WORDS_PER_MINUTE = 85;

export function wordTarget(minutes: number): number {
  return Math.round(minutes * WORDS_PER_MINUTE);
}
