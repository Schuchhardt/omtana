import { handleRevoke } from "@/lib/oauth/handlers";
import { preflight } from "@/lib/oauth/http";
import { supabaseOAuthStore } from "@/lib/oauth/store";

/** Revocación (RFC 7009). */
export async function POST(request: Request) {
  return handleRevoke(request, supabaseOAuthStore);
}

export const OPTIONS = preflight;
