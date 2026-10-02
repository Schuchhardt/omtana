import { CREDITS_PLAN, LOCALES, PLAN } from "@/lib/config";
import { copy, localePath, type UiLang } from "@/lib/i18n";
import { paymentsEnabled } from "@/lib/payments";
import { SITE_URL, absoluteUrl, jsonLd } from "@/lib/seo";

/**
 * Datos estructurados de la portada.
 *
 * Le dicen a Google y a los motores de respuesta (ChatGPT, Perplexity, AI
 * Overviews…) qué es Omtana sin que tengan que deducirlo del diseño: la
 * organización, el sitio, la aplicación con sus precios y las preguntas
 * frecuentes con sus respuestas. Todo sale del diccionario, así que la versión
 * en inglés se describe en inglés.
 */
export function LandingJsonLd({ lang }: { lang: UiLang }) {
  const t = copy(lang);
  const url = absoluteUrl(localePath(lang, "/"));
  const org = `${SITE_URL}/#organization`;

  const amount = (price: string) => price.replace(/[^\d.]/g, "");
  const offers = [
    { name: PLAN.free.tag, price: "0" },
    ...(paymentsEnabled()
      ? [
          { name: t.plans.credits.tag, price: amount(CREDITS_PLAN.price), unit: t.plans.credits.per },
          { name: PLAN.pro.tag, price: amount(PLAN.pro.price), unit: t.plans.pro.per },
        ]
      : []),
  ].map((o) => ({
    "@type": "Offer",
    name: o.name,
    price: o.price,
    priceCurrency: "USD",
    ...("unit" in o ? { description: o.unit } : {}),
  }));

  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": org,
        name: "Omtana",
        url: SITE_URL,
        logo: absoluteUrl("/icons/icon-512.png"),
        email: "hola@omtana.com",
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: "Omtana",
        url: SITE_URL,
        publisher: { "@id": org },
        inLanguage: ["es", "en"],
      },
      {
        "@type": "WebApplication",
        name: "Omtana",
        url,
        description: t.meta.description,
        applicationCategory: "HealthApplication",
        operatingSystem: "Web, iOS, Android",
        inLanguage: LOCALES.map((l) => l.code),
        publisher: { "@id": org },
        offers,
      },
      {
        "@type": "FAQPage",
        url,
        inLanguage: lang,
        mainEntity: t.faq.items.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}
