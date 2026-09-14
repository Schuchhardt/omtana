import Link from "next/link";
import { PLAN, CREDITS_PLAN } from "@/lib/config";
import { copy, type UiLang } from "@/lib/i18n";
import type { Plan } from "@/lib/types";

interface Card {
  id: string;
  tag: string;
  price: string;
  per: string;
  features: readonly string[];
  cta: string;
  href: string;
  featured?: boolean;
}

/**
 * Los precios y el tope de personalizaciones salen de `config`, que es la
 * fuente única; los rótulos y las viñetas salen del diccionario, porque son
 * copia y cambian con el idioma de la interfaz.
 */
export function PlanCards({
  currentPlan,
  lang = "es",
}: {
  currentPlan: Plan | null;
  lang?: UiLang;
}) {
  const t = copy(lang).plans;

  const cards: Card[] = [
    {
      id: "free",
      tag: t.free.tag,
      price: PLAN.free.price,
      per: t.free.per,
      features: t.free.features,
      cta: currentPlan === "free" ? t.currentCta : t.free.cta,
      href: currentPlan ? "/home" : "/acceso?modo=crear",
    },
    {
      id: "credits",
      tag: t.credits.tag,
      price: CREDITS_PLAN.price,
      per: t.credits.per,
      features: t.credits.features,
      cta: t.credits.cta,
      href: "/planes#creditos",
    },
    {
      id: "pro",
      tag: t.pro.tag,
      price: PLAN.pro.price,
      per: t.pro.per,
      features: t.pro.features,
      cta: currentPlan === "pro" ? t.currentCta : t.pro.cta,
      href: "/planes#pro",
      featured: true,
    },
  ];

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-[14px]">
      {cards.map((c) => {
        const isCurrent = currentPlan === c.id;
        return (
          <div
            key={c.id}
            className={`flex flex-col rounded-card border p-7 ${
              c.featured ? "border-clay bg-paper" : "border-line-soft bg-paper"
            }`}
          >
            <div className="mb-4 flex items-center gap-[10px]">
              <span className="text-[13px] uppercase tracking-[0.18em] text-muted-soft">
                {c.tag}
              </span>
              {isCurrent && (
                <span className="rounded-full border border-line px-[9px] py-[2px] text-[12px] text-clay">
                  {t.currentBadge}
                </span>
              )}
            </div>

            <div className="text-[36px] font-light tracking-[-0.02em]">{c.price}</div>
            <div className="mb-6 text-[14px] text-muted-soft">{c.per}</div>

            <div className="mb-7 flex flex-col gap-[10px]">
              {c.features.map((f) => (
                <div key={f} className="flex gap-[10px] text-[15px] leading-[1.5] text-ink-soft">
                  <span className="text-clay">—</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>

            <Link
              href={c.href}
              aria-disabled={isCurrent}
              className={`om-btn mt-auto w-full py-[15px] ${
                isCurrent
                  ? "pointer-events-none border-line-pill text-faint"
                  : c.featured
                    ? "om-btn-solid"
                    : "om-btn-ghost"
              }`}
            >
              {c.cta}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
