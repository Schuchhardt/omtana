import { handleRegister } from "@/lib/oauth/handlers";
import { preflight } from "@/lib/oauth/http";
import { recentRegistrations, saveClient } from "@/lib/oauth/store";

/**
 * Registro dinámico de clientes (RFC 7591). La especificación MCP 2026-07-28 lo
 * deja como deprecado a favor de los Client ID Metadata Documents (que también
 * se soportan), pero es lo que usan hoy muchos clientes, claude.ai incluido.
 */
export async function POST(request: Request) {
  return handleRegister(request, { saveClient, recentRegistrations });
}

export const OPTIONS = preflight;
