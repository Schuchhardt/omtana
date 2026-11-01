import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Lo puro de las credenciales MCP: el formato de la llave, cómo se lee del
 * encabezado y la comparación del token de admin. Sin base ni "server-only",
 * para poder probarlo directo.
 */

export const KEY_PREFIX = "omt_";

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Credencial del MCP de administración: `OMTANA_ADMIN_MCP_TOKEN` (varias
 * separadas por coma, para rotar sin cortar). Sin la variable, el endpoint de
 * admin no existe: responde 401 a todo.
 */
export function isAdminToken(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const token = bearerToken(request);
  if (!token) return false;
  const allowed = (env.OMTANA_ADMIN_MCP_TOKEN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length >= 24);
  const given = Buffer.from(hashKey(token), "hex");
  return allowed.some((candidate) => timingSafeEqual(Buffer.from(hashKey(candidate), "hex"), given));
}
