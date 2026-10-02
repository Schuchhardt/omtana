import { CREDITS_PLAN, DURATIONS, PLAN } from "@/lib/config";
import { copy, localePath, type UiLang } from "@/lib/i18n";
import { PUBLIC_ROUTES, type PublicPath } from "@/lib/i18n/routes";
import { paymentsEnabled } from "@/lib/payments";
import { absoluteUrl } from "@/lib/seo";

/**
 * `/llms.txt`: resumen en Markdown para los modelos que responden preguntas
 * sobre Omtana (ver llmstxt.org). Sale de los mismos diccionarios que el
 * sitio, en los dos idiomas, así que no se desincroniza de la portada.
 */
export const dynamic = "force-static";

function section(lang: UiLang): string {
  const t = copy(lang);
  const link = (path: PublicPath, label: string, note: string) =>
    `- [${label}](${absoluteUrl(localePath(lang, path))}): ${note}`;

  const prices = [
    `${PLAN.free.tag}: ${PLAN.free.price} (${t.plans.free.per}) — ${t.plans.free.features.join("; ")}`,
    ...(paymentsEnabled()
      ? [
          `${t.plans.credits.tag}: ${CREDITS_PLAN.price} ${t.plans.credits.per} — ${t.plans.credits.features.join("; ")}`,
          `${PLAN.pro.tag}: ${PLAN.pro.price} ${t.plans.pro.per} — ${t.plans.pro.features.join("; ")}`,
        ]
      : []),
  ];

  return [
    `## ${lang === "es" ? "Español" : "English"}`,
    "",
    `> ${t.meta.description}`,
    "",
    t.hero.body,
    "",
    ...t.steps.map((s) => `${s.n}. **${s.title}**: ${s.body}`),
    "",
    `- ${lang === "es" ? "Duraciones" : "Lengths"}: ${DURATIONS.join(", ")} min`,
    `- ${t.footer.languages}`,
    ...prices.map((p) => `- ${p}`),
    "",
    `### ${lang === "es" ? "Páginas" : "Pages"}`,
    "",
    link("/", "Omtana", t.meta.ogDescription),
    link("/catalogo", t.meta.titles.catalog, t.meta.descriptions.catalog),
    link("/voces", t.meta.titles.voices, t.meta.descriptions.voices),
    link("/terminos", t.meta.titles.terms, t.meta.descriptions.terms),
    "",
    `### ${t.faq.title}`,
    "",
    ...t.faq.items.flatMap((f) => [`**${f.q}**`, "", f.a, ""]),
  ].join("\n");
}

export function GET() {
  const body = [
    "# Omtana",
    "",
    `Omtana (${absoluteUrl("/")} · ${absoluteUrl(PUBLIC_ROUTES["/"])}) — ${copy("en").footer.tagline} / ${copy("es").footer.tagline}`,
    `Contact: hola@omtana.com`,
    "",
    section("es"),
    section("en"),
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
