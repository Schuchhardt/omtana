/**
 * Orígenes de navegador que pueden llamar a los MCP.
 *
 * Los clientes MCP de escritorio y de servidor (Claude Code, Claude Desktop,
 * el conector de la API) no mandan `Origin`, así que pasan siempre. Un
 * navegador sí lo manda, y la especificación pide rechazar los desconocidos
 * para que una página cualquiera no pueda usar el servidor. Se permiten el
 * propio sitio y lo que diga `MCP_ALLOWED_ORIGINS` (separados por coma), por
 * ejemplo el inspector de MCP en `http://localhost:6274`.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = (env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  for (const url of [env.NEXT_PUBLIC_SITE_URL, env.URL]) {
    if (!url) continue;
    try {
      list.push(new URL(url).origin);
    } catch {
      /* URL mal escrita: se ignora */
    }
  }
  return [...new Set(list)];
}
