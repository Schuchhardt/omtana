/**
 * Qué parte de un error de generación se le muestra a la persona.
 *
 * El mensaje completo queda en `omtana_generation_jobs.error` y sale en el
 * aviso al equipo (`lib/alerts.ts`). Lo que ve quien generó la sesión es otra
 * cosa: "No hay ffmpeg en este entorno…" no le sirve de nada y además cuenta
 * cómo está armado el servidor. Solo hay un error que es suyo y que puede
 * arreglar —el modelo se negó a escribir con ese contexto— y ese se reconoce
 * por su texto, que es estable.
 *
 * Sin dependencias a propósito: lo importan la app, el motor y las funciones
 * de Netlify.
 */

export const SCRIPT_REFUSED =
  "El modelo no escribió este guion. Revisa el contexto entregado y vuelve a intentar.";

export type GenerationErrorKind = "refused" | "internal";

export function classifyGenerationError(message: string | null | undefined): GenerationErrorKind {
  return message?.startsWith(SCRIPT_REFUSED) ? "refused" : "internal";
}
