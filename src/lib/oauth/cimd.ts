import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { clientFromMetadataDocument, isMetadataDocumentId, OAuthError, type OAuthClient } from "./core";

/**
 * Client ID Metadata Documents: el client_id es una URL https y el servidor de
 * autorización va a buscar ahí la descripción del cliente (nombre, redirect
 * URIs). Es el mecanismo de registro que recomienda la especificación MCP.
 *
 * Ir a buscar una URL que eligió un tercero es la receta del SSRF, así que:
 * - solo https, con un host de verdad (nada de IPs escritas a mano);
 * - la IP se valida en el `lookup` que usa la conexión misma, no en una
 *   consulta previa: así un DNS que cambia entre la validación y la conexión
 *   (DNS rebinding) no cuela una dirección interna;
 * - se bloquean loopback, redes privadas, link-local (169.254.x: metadata de
 *   la nube), CGNAT, multicast y reservadas, en IPv4 e IPv6;
 * - no se siguen redirecciones, 5 s de tope y 64 KB como máximo.
 */

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 5_000;
const CACHE_MIN_MS = 60_000;
const CACHE_DEFAULT_MS = 10 * 60_000;
const CACHE_MAX_MS = 60 * 60_000;

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["64:ff9b::", 96],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** ¿Es una dirección pública, a la que está bien conectarse? */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) {
    // ::ffff:10.0.0.1 es una IPv4 disfrazada: se revisa como IPv4.
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return !blocked.check(mapped[1], "ipv4");
    return !blocked.check(address, "ipv6");
  }
  return false;
}

/** `lookup` para la conexión: resuelve y rechaza cualquier dirección no pública. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = (addresses as LookupAddress[]).filter((a) => isPublicAddress(a.address));
    if (list.length === 0) {
      return callback(Object.assign(new Error(`${hostname} no resuelve a una dirección pública`), { code: "EBLOCKED" }), "", 0);
    }
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

function maxAge(header: string | string[] | undefined): number {
  const value = Array.isArray(header) ? header.join(",") : (header ?? "");
  if (/no-store|no-cache/i.test(value)) return CACHE_MIN_MS;
  const match = value.match(/max-age=(\d+)/i);
  const ms = match ? Number(match[1]) * 1000 : CACHE_DEFAULT_MS;
  return Math.min(CACHE_MAX_MS, Math.max(CACHE_MIN_MS, ms));
}

function download(url: URL): Promise<{ body: string; maxAgeMs: number }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        headers: { accept: "application/json", "user-agent": "omtana-oauth/1" },
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`respondió ${res.statusCode}${res.statusCode && res.statusCode >= 300 && res.statusCode < 400 ? " (no se siguen redirecciones)" : ""}`));
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error("el documento pasa de 64 KB"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), maxAgeMs: maxAge(res.headers["cache-control"]) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("no respondió en 5 s")));
    req.on("error", reject);
    req.end();
  });
}

const cache = new Map<string, { client: OAuthClient; until: number }>();

/** Solo para tests. */
export function clearClientMetadataCache(): void {
  cache.clear();
}

/**
 * El cliente descrito por su documento de metadata. Lanza `invalid_client`
 * si la URL no sirve, el documento no se pudo traer o no es válido.
 */
export async function fetchClientMetadata(
  clientId: string,
  deps: { download?: (url: URL) => Promise<{ body: string; maxAgeMs: number }>; now?: () => number } = {},
): Promise<OAuthClient> {
  const now = (deps.now ?? Date.now)();
  const hit = cache.get(clientId);
  if (hit && hit.until > now) return hit.client;

  if (!isMetadataDocumentId(clientId)) throw new OAuthError("invalid_client", "El client_id no es una URL https válida.");
  const url = new URL(clientId);
  if (isIP(url.hostname.replace(/^\[|\]$/g, ""))) {
    throw new OAuthError("invalid_client", "El documento del cliente tiene que estar en un dominio, no en una IP.");
  }

  let fetched: { body: string; maxAgeMs: number };
  try {
    fetched = await (deps.download ?? download)(url);
  } catch (err) {
    throw new OAuthError("invalid_client", `No se pudo leer el documento del cliente: ${err instanceof Error ? err.message : err}.`);
  }

  let doc: unknown;
  try {
    doc = JSON.parse(fetched.body);
  } catch {
    throw new OAuthError("invalid_client", "El documento del cliente no es JSON.");
  }
  const client = clientFromMetadataDocument(clientId, doc);
  cache.set(clientId, { client, until: now + fetched.maxAgeMs });
  return client;
}
