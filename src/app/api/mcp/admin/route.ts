import { handleMcp } from "@/lib/mcp/protocol";
import { adminServer } from "@/lib/mcp/admin-server";

/**
 * MCP de administración (Streamable HTTP, sin estado).
 *
 *   POST /api/mcp/admin
 *   Authorization: Bearer <OMTANA_ADMIN_MCP_TOKEN>
 *
 * Sin la variable, rechaza todo. Ver src/lib/mcp/admin-server.ts.
 */

export const maxDuration = 60;

export async function POST(request: Request) {
  return handleMcp(request, adminServer);
}

export async function GET(request: Request) {
  return handleMcp(request, adminServer);
}

export async function DELETE(request: Request) {
  return handleMcp(request, adminServer);
}
