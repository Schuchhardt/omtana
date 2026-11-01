import { createHash } from "node:crypto";
import { siteUrlFor } from "../site";
import { oauthConfig, OAuthError, type OAuthConfig } from "./core";

/**
 * Lo que comparten las rutas de OAuth: configuración, CORS y respuestas.
 * Sin "server-only": no toca la base ni secretos, y los tests lo importan.
 */

export function configFor(request: Request): OAuthConfig {
  return oauthConfig(siteUrlFor(request));
}

/**
 * Los endpoints de metadata, registro, token y revocación no usan cookies, así
 * que se pueden abrir a cualquier origen: hay clientes MCP que corren en el
 * navegador (el inspector, por ejemplo).
 */
export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-max-age": "86400",
};

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      pragma: "no-cache",
      ...CORS,
      ...headers,
    },
  });
}

export function oauthErrorResponse(err: unknown): Response {
  if (err instanceof OAuthError) {
    const headers: Record<string, string> = err.status === 401 ? { "www-authenticate": 'Basic realm="omtana"' } : {};
    return oauthJson(err.toJSON(), err.status, headers);
  }
  console.error("[omtana:oauth]", err);
  return oauthJson({ error: "server_error", error_description: "Error interno." }, 500);
}

/** El cuerpo de un POST de OAuth: formulario (lo estándar) o JSON (por tolerancia). */
export async function readParams(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    return Object.fromEntries(
      Object.entries(body ?? {}).filter(([, v]) => typeof v === "string") as [string, string][],
    );
  }
  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text));
}

/** sha256 de la IP: para limitar registros sin guardar la IP. */
export function clientIpHash(request: Request): string | null {
  const ip =
    request.headers.get("x-nf-client-connection-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip");
  return ip ? createHash("sha256").update(`omtana:${ip}`).digest("hex") : null;
}
