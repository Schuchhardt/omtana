/**
 * A dónde volver después de iniciar sesión. Solo rutas de este mismo sitio:
 * `//otro.com`, `/\otro.com` o `https://…` se descartan, así `/acceso?next=`
 * no sirve de redirector hacia afuera.
 */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4000) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  try {
    const base = "http://omtana.invalid";
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}
