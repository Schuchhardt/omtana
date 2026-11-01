import { handleMcp } from "@/lib/mcp/protocol";
import { userServer } from "@/lib/mcp/user-server";

/**
 * MCP para personas (Streamable HTTP, sin estado).
 *
 *   POST /api/mcp
 *   Authorization: Bearer omt_…   ← se crea en /perfil
 *
 * Ver src/lib/mcp/user-server.ts para las herramientas y README → "MCP".
 */

// La espera de una generación (`wait_seconds`) llega a 45 s; la función de
// Netlify se corta a los 60.
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleMcp(request, userServer);
}

export async function GET(request: Request) {
  return handleMcp(request, userServer);
}

export async function DELETE(request: Request) {
  return handleMcp(request, userServer);
}
