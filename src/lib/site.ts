/**
 * La URL pública del sitio, sin barra final: `NEXT_PUBLIC_SITE_URL` si está, y
 * si no el origen de la petición. Es el emisor de OAuth y la base de las URIs
 * canónicas de los MCP, así que todo lo que las arma pasa por acá.
 */
export function siteUrl(origin: string): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || origin).replace(/\/+$/, "");
}

export function siteUrlFor(request: Request): string {
  return siteUrl(new URL(request.url).origin);
}
