import { currentUser } from "@/lib/auth";
import { siteUrlFor } from "@/lib/site";
import { denyUrl, isAdminEmail, issueCode, oauthConfig } from "@/lib/oauth/core";
import { pickParams, resolveAuthorize } from "@/lib/oauth/authorize";
import { supabaseOAuthStore } from "@/lib/oauth/store";
import { logEvent } from "@/lib/telemetry";

/**
 * La decisión de la pantalla de consentimiento.
 *
 * Contra CSRF: la cookie de sesión es SameSite=Lax (no viaja en un POST desde
 * otro sitio) y además se exige que el formulario venga de este mismo origen.
 * La petición se vuelve a validar entera; lo que diga el formulario no se cree.
 */

const see = (url: string) => new Response(null, { status: 303, headers: { location: url, "cache-control": "no-store" } });

function sameOrigin(request: Request): boolean {
  const own = new URL(request.url).origin;
  const site = siteUrlFor(request);
  const origin = request.headers.get("origin");
  if (origin) return origin === own || origin === new URL(site).origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Origen no permitido", { status: 403 });

  const form = await request.formData();
  const params = pickParams(form);
  const cfg = oauthConfig(siteUrlFor(request));

  const user = await currentUser();
  if (!user) {
    const back = `/oauth/authorize?${new URLSearchParams(params as Record<string, string>).toString()}`;
    return see(`/acceso?next=${encodeURIComponent(back)}`);
  }

  const outcome = await resolveAuthorize(cfg, params);
  if (outcome.kind === "redirect") return see(outcome.url);
  if (outcome.kind === "error") return new Response(outcome.message, { status: 400 });
  const req = outcome.request;

  if (form.get("decision") !== "allow") return see(denyUrl(cfg, req));
  if (req.kind === "admin" && !isAdminEmail(user.email)) return see(denyUrl(cfg, req));

  const url = await issueCode(cfg, supabaseOAuthStore, req, user.id);
  await logEvent({
    source: "oauth",
    message: `acceso aprobado para ${req.client.client_name}`,
    data: { client_id: req.client.client_id, resource: req.resource, scope: req.scope },
    trace: { userId: user.id, via: "oauth" },
  });
  return see(url);
}
