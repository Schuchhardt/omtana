import { reapStaleJobs } from "../../src/lib/generation/jobs";

/**
 * Cada quince minutos da por fallidas las generaciones que nadie va a
 * terminar —la función se cortó a los 15 minutos, el encargo se perdió— y
 * avisa al equipo por cada una.
 *
 * `/status` hace lo mismo con una sesión cuando alguien la está esperando;
 * esto cubre a quien cerró la pestaña: sin barrido, esa falla no la vería
 * nadie. El crédito se devuelve cuando la persona vuelve a abrir la sesión.
 */
export default async function handler(): Promise<void> {
  const reaped = await reapStaleJobs();
  if (reaped.length) {
    console.log(`[omtana] ${reaped.length} generación(es) colgada(s) marcadas como fallidas.`);
  }
}

export const config = {
  schedule: "*/15 * * * *",
};
