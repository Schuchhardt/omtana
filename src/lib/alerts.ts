/**
 * Avisos al equipo cuando algo se rompe en producción.
 *
 * Antes una generación fallida solo quedaba en la tabla de jobs y en el log de
 * la función: la persona veía "Te devolvimos la personalización" y nadie más se
 * enteraba. Ahora cada falla sale por los canales que estén configurados:
 *
 * - `ALERT_WEBHOOK_URL`: un webhook entrante de Slack, Discord o Google Chat
 *   (varios separados por coma). El cuerpo lleva `text` y `content`, que son
 *   los campos que leen Slack/Google Chat y Discord respectivamente.
 * - `RESEND_API_KEY` + `ALERT_EMAIL_TO`: un correo vía Resend. `ALERT_EMAIL_FROM`
 *   tiene que ser de un dominio verificado en Resend.
 *
 * Sin ninguno, el aviso queda igual en el log con el prefijo `[omtana:alerta]`.
 *
 * Nunca lanza: un aviso que no sale no puede tapar el error que lo provocó.
 *
 * Sin "server-only" ni alias `@/` a propósito: lo importan las funciones de
 * Netlify, que se empaquetan fuera de Next.
 */

export interface Alert {
  /** Una línea: qué se rompió. */
  title: string;
  /** El error tal cual, para no tener que ir a buscarlo. */
  detail?: string;
  /** Contexto corto: ids, paso, duración. Nada que la persona escribió. */
  fields?: Record<string, string | number | boolean | null | undefined>;
}

export interface AlertResult {
  delivered: string[];
  failed: string[];
}

interface AlertDeps {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  log?: (...args: unknown[]) => void;
}

const TIMEOUT_MS = 5_000;
/** Discord corta en 2000 caracteres; Slack aguanta más pero no hace falta. */
const MAX_TEXT = 1_900;

/** De qué despliegue viene el aviso: producción y un deploy preview no pesan igual. */
function origin(env: NodeJS.ProcessEnv): string | null {
  const where = env.URL || env.NEXT_PUBLIC_SITE_URL || null;
  const context = env.CONTEXT || (env.NETLIFY === "true" ? "netlify" : null);
  const build = env.NEXT_PUBLIC_BUILD_ID || env.COMMIT_REF?.slice(0, 7) || null;
  const parts = [where, context, build].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function formatAlert(alert: Alert, env: NodeJS.ProcessEnv = process.env): string {
  const lines = [`🔴 Omtana · ${alert.title}`];
  for (const [key, value] of Object.entries(alert.fields ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    lines.push(`• ${key}: ${value}`);
  }
  const from = origin(env);
  if (from) lines.push(`• despliegue: ${from}`);
  if (alert.detail) lines.push("", alert.detail.trim());

  const text = lines.join("\n");
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

export function alertChannels(env: NodeJS.ProcessEnv = process.env): string[] {
  const channels: string[] = [];
  const hooks = (env.ALERT_WEBHOOK_URL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  hooks.forEach((_, i) => channels.push(hooks.length > 1 ? `webhook#${i + 1}` : "webhook"));
  if (env.RESEND_API_KEY && env.ALERT_EMAIL_TO) channels.push("email");
  return channels;
}

async function post(
  doFetch: typeof fetch,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  const res = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`.trim());
  }
}

export async function notifyAdmin(alert: Alert, deps: AlertDeps = {}): Promise<AlertResult> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? fetch;
  const log = deps.log ?? console.error;
  const text = formatAlert(alert, env);
  const result: AlertResult = { delivered: [], failed: [] };

  // El log va siempre: es el último recurso y lo que se busca en Netlify.
  log(`[omtana:alerta] ${text}`);

  const jobs: Array<{ name: string; send: () => Promise<void> }> = [];

  const hooks = (env.ALERT_WEBHOOK_URL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  hooks.forEach((url, i) => {
    jobs.push({
      name: hooks.length > 1 ? `webhook#${i + 1}` : "webhook",
      send: () => post(doFetch, url, { text, content: text }),
    });
  });

  const resendKey = env.RESEND_API_KEY;
  const emailTo = (env.ALERT_EMAIL_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (resendKey && emailTo.length) {
    jobs.push({
      name: "email",
      send: () =>
        post(
          doFetch,
          "https://api.resend.com/emails",
          {
            from: env.ALERT_EMAIL_FROM || "Omtana <onboarding@resend.dev>",
            to: emailTo,
            subject: `[Omtana] ${alert.title}`.slice(0, 150),
            text,
          },
          { authorization: `Bearer ${resendKey}` },
        ),
    });
  }

  const outcomes = await Promise.allSettled(jobs.map((j) => j.send()));
  outcomes.forEach((outcome, i) => {
    const name = jobs[i].name;
    if (outcome.status === "fulfilled") {
      result.delivered.push(name);
    } else {
      result.failed.push(name);
      const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      log(`[omtana:alerta] no salió por ${name}: ${reason}`);
    }
  });

  return result;
}
