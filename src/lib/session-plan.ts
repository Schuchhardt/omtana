import { breathingSlotSeconds } from "./breathing";
import type { SectionKind } from "./types";

export interface PlannedSection {
  position: number;
  kind: SectionKind;
  /** Duración objetivo en segundos; el audio se rellena con silencio hasta ahí. */
  seconds: number;
  label: string;
  /** Ritmo al que se lee esta sección, en palabras por minuto. */
  wordsPerMinute: number;
  /** Qué debe decir esta sección; guía al modelo cuando kind === "dynamic". */
  brief: string;
}

/**
 * Reparte el cuerpo de una meditación: bloques fijos (audio ya pregenerado)
 * más el tramo que se escribe para la persona. Es el mismo reparto que muestra
 * el panel "Tu sesión" al personalizar, así que la vista previa y lo que se
 * genera no pueden separarse.
 *
 * La respiración **no** está acá. Dejó de ser un bloque de guion — la voz no
 * podía sostener un conteo a tiempo — y pasó a ser una pista aparte con su
 * propio reloj (`./breathing`). La sesión le sigue reservando el mismo hueco
 * que ocupaba, y por eso el reparto de lo demás no cambió: las plantillas ya
 * generadas siguen calzando.
 *
 * Lo que el ejercicio no usa de ese hueco se lo lleva el tramo personalizado,
 * que es el que se escribe cada vez y puede adaptarse sin costo. Sin
 * respiración, se lo lleva entero.
 *
 * 15 min → 2:30 (respiración) + 2 + 4 + 4:30 + 2.  5 min → 2 + 1 + 1 + 1: con
 * dos minutos de respiración, una sesión de cinco no da para un bloque de
 * refuerzo, y el reparto lo deja fuera solo.
 */
export function planSession(
  durationMinutes: number,
  breathingSeconds = 0,
): PlannedSection[] {
  const short = durationMinutes <= 5;
  const slot = breathingSlotSeconds(durationMinutes);
  const block = (short ? 1 : 2) * 60;
  const dynamic = Math.max(1, Math.round(durationMinutes * 0.25)) * 60;
  const reinforcement = durationMinutes * 60 - slot - block * 2 - dynamic;
  const slack = Math.max(0, slot - breathingSeconds);

  const raw: Omit<PlannedSection, "position">[] = [
    {
      kind: "fixed",
      label: "Entrada al cuerpo",
      seconds: block,
      wordsPerMinute: WORDS_PER_MINUTE,
      brief: "Recorrido corporal breve y aterrizaje en el presente.",
    },
    {
      kind: "dynamic",
      label: "Tu contexto",
      seconds: dynamic + slack,
      wordsPerMinute: WORDS_PER_MINUTE,
      brief:
        "El tramo escrito para esta persona: toma su intención y su contexto literal y los trabaja en segunda persona.",
    },
    {
      kind: "fixed",
      label: "Refuerzo e imágenes",
      seconds: reinforcement,
      wordsPerMinute: WORDS_PER_MINUTE,
      brief: "Imágenes de refuerzo y repetición de la intención en abstracto.",
    },
    {
      kind: "fixed",
      label: "Cierre",
      seconds: block,
      wordsPerMinute: WORDS_PER_MINUTE,
      brief: "Vuelta gradual, apertura de ojos y cierre.",
    },
  ];

  return raw
    .filter((s) => s.seconds > 0)
    .map((s, i) => ({ ...s, position: i }));
}

export function planTotals(sections: PlannedSection[]) {
  const seconds = sections.reduce((n, s) => n + s.seconds, 0);
  const dynamicSeconds = sections
    .filter((s) => s.kind === "dynamic")
    .reduce((n, s) => n + s.seconds, 0);
  return { seconds, dynamicSeconds, fixedSeconds: seconds - dynamicSeconds };
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

export function wordTarget(section: Pick<PlannedSection, "seconds" | "wordsPerMinute">): number {
  return Math.round((section.seconds / 60) * section.wordsPerMinute);
}

/** Minutos redondeados, para mostrar. El reparto interno va en segundos. */
export function sectionMinutes(section: Pick<PlannedSection, "seconds">): number {
  return Math.max(1, Math.round(section.seconds / 60));
}

/* ───────────────────────── vista de la sesión ───────────────────────── */

export interface OutlineRow {
  key: string;
  kind: SectionKind | "breathing";
  label: string;
  seconds: number;
}

/**
 * La sesión completa como se le muestra a la persona: la respiración elegida
 * más el cuerpo. La landing y el personalizador pintan esto mismo, así que lo
 * que se promete en la portada es el reparto que después se genera.
 */
export function planOutline(
  durationMinutes: number,
  breathing: { label: string; seconds: number } | null,
): OutlineRow[] {
  const body = planSession(durationMinutes, breathing?.seconds ?? 0).map((s) => ({
    key: `s${s.position}`,
    kind: s.kind,
    label: s.label,
    seconds: s.seconds,
  }));

  if (!breathing) return body;
  return [
    { key: "breathing", kind: "breathing" as const, label: breathing.label, seconds: breathing.seconds },
    ...body,
  ];
}
