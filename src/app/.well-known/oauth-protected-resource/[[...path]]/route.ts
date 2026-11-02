import { handleResourceMetadata } from "@/lib/oauth/handlers";
import { preflight } from "@/lib/oauth/http";

/** Protected Resource Metadata (RFC 9728) de cada MCP. Ver handlers.ts. */
export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  return handleResourceMetadata(request, (await params).path ?? []);
}

export const OPTIONS = preflight;
