import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { getLang } from "@/lib/lang";
import { PRIVATE_ROBOTS } from "@/lib/seo";
import { copy, fill } from "@/lib/i18n";
import { siteUrl } from "@/lib/site";
import { clientHost, denyUrl, isAdminEmail, isLoopbackRedirect, oauthConfig } from "@/lib/oauth/core";
import { AUTHORIZE_PARAMS, pickParams, resolveAuthorize } from "@/lib/oauth/authorize";

/**
 * Pantalla de consentimiento de OAuth: "esta app quiere usar tu cuenta".
 *
 * Valida la petición entera antes de mostrar nada; sin sesión manda a /acceso y
 * vuelve acá. Lo que se muestra —quién pide, a dónde vuelve, qué va a poder
 * hacer— es lo que pide la especificación MCP para que la persona decida con
 * los datos a la vista. La decisión va por POST a /api/oauth/authorize, que
 * vuelve a validar todo.
 */

export async function generateMetadata(): Promise<Metadata> {
  return { title: copy(await getLang()).oauth.eyebrow, robots: PRIVATE_ROBOTS };
}

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const key of AUTHORIZE_PARAMS) {
    const value = raw[key];
    if (typeof value === "string") query.set(key, value);
  }
  const params = pickParams(query);
  const cfg = oauthConfig(siteUrl(await requestOrigin()));
  const t = copy(await getLang()).oauth;

  const outcome = await resolveAuthorize(cfg, params);
  if (outcome.kind === "redirect") redirect(outcome.url);
  if (outcome.kind === "error") {
    return (
      <main className="om-shell flex justify-center pb-24 pt-16">
        <div className="om-card w-full max-w-[520px] px-7 py-[30px]">
          <div className="om-label mb-3">{t.eyebrow}</div>
          <h1 className="mb-3 text-[26px]">{t.errorTitle}</h1>
          <p className="text-[15px] leading-[1.6] text-muted">{outcome.message}</p>
        </div>
      </main>
    );
  }

  const request = outcome.request;
  const user = await currentUser();
  if (!user) redirect(`/acceso?next=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`);

  if (request.kind === "admin" && !isAdminEmail(user.email)) redirect(denyUrl(cfg, request));

  const hosts = clientHost(request.client, request.redirectUri);
  const abilities = request.kind === "admin" ? t.adminAbilities : t.userAbilities;
  const name = request.client.client_name;

  return (
    <main className="om-shell flex justify-center pb-24 pt-16">
      <div className="om-card w-full max-w-[560px] px-7 py-[30px]">
        <div className="om-label mb-3">{t.eyebrow}</div>
        <h1 className="mb-2 text-[clamp(24px,3.2vw,30px)] leading-[1.25]">
          {fill(request.kind === "admin" ? t.titleAdmin : t.title, { client: name })}
        </h1>
        <p className="mb-6 text-[15px] text-muted-soft">{fill(t.account, { email: user.email })}</p>

        <div className="mb-2 text-[15px] text-muted">{t.canDo}</div>
        <ul className="mb-4 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-[1.55]">
          {abilities.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mb-6 text-[14px] text-faint">{t.cannot}</p>

        <div className="mb-6 flex flex-col gap-2 rounded-card border border-line px-4 py-3 text-[14px] leading-[1.5]">
          {hosts.client ? (
            <span>{fill(t.verified, { host: hosts.client })}</span>
          ) : (
            <span className="text-faint">{t.unverified}</span>
          )}
          <span>{fill(t.returnsTo, { host: hosts.redirect })}</span>
          {isLoopbackRedirect(request.redirectUri) && <span className="text-danger">{t.localhost}</span>}
        </div>

        <form method="post" action="/api/oauth/authorize" className="flex flex-wrap gap-3">
          {Object.entries(params).map(([key, value]) =>
            value === undefined ? null : <input key={key} type="hidden" name={key} value={value} />,
          )}
          <button type="submit" name="decision" value="allow" className="om-btn om-btn-solid px-6 py-[13px] text-[15px]">
            {t.allow}
          </button>
          <button type="submit" name="decision" value="deny" className="om-btn om-btn-ghost px-6 py-[13px] text-[15px]">
            {t.deny}
          </button>
        </form>

        <p className="mt-5 text-[13px] text-faint">{t.revokeNote}</p>
        <form action="/api/auth/logout" method="post" className="mt-2">
          <button type="submit" className="cursor-pointer text-[13px] text-ink-soft hover:text-clay">
            {t.switchAccount}
          </button>
        </form>
      </div>
    </main>
  );
}
