import { handleToken } from "@/lib/oauth/handlers";
import { preflight } from "@/lib/oauth/http";
import { purgeExpired, supabaseOAuthStore } from "@/lib/oauth/store";

/** Token endpoint: canjea el código (con PKCE) y rota los refresh tokens. */
export async function POST(request: Request) {
  return handleToken(request, supabaseOAuthStore, {
    // Limpieza ocasional de códigos y tokens vencidos: sin cron y sin costo apreciable.
    afterSuccess: async () => {
      if (Math.random() < 0.02) await purgeExpired();
    },
  });
}

export const OPTIONS = preflight;
