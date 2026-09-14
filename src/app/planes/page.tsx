import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Checkout } from "./Checkout";
import { PlanCards } from "@/components/PlanCards";
import { SiteFooter } from "@/components/SiteFooter";
import { currentUser } from "@/lib/auth";
import { listLedger, remainingFree } from "@/lib/queries";
import { stripeConfigured } from "@/lib/stripe";
import { formatDate } from "@/lib/format";
import { PLAN } from "@/lib/config";
import { getLang } from "@/lib/lang";
import { copy, fill, ledgerReason, plural } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: copy(await getLang()).meta.titles.plans };
}

export default async function PlanesPage({
  searchParams,
}: {
  searchParams: Promise<{ pago?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/acceso");

  const [ledger, { pago }, lang] = await Promise.all([
    listLedger(user.id),
    searchParams,
    getLang(),
  ]);

  const t = copy(lang).plansPage;
  const left = remainingFree(user);

  const nextPeriod = new Date(user.period_started);
  nextPeriod.setMonth(nextPeriod.getMonth() + 1);

  const quotaLine =
    user.plan === "pro"
      ? t.bodyPro
      : fill(plural(t.bodyFree, left), {
          n: left,
          total: PLAN.free.monthlyCustomizations,
        }) + fill(t.renewsOn, { date: formatDate(nextPeriod.toISOString(), lang) });

  return (
    <main>
      <div className="om-shell pb-24 pt-14">
        <p className="om-eyebrow mb-[10px]">{t.eyebrow}</p>
        <h1 className="mb-3 text-[clamp(28px,4vw,40px)]">
          {fill(t.title, { plan: user.plan === "pro" ? "Pro" : "Free" })}
        </h1>
        <p className="mb-4 max-w-[54ch] text-[17px] leading-[1.6] text-muted">
          {quotaLine}
          {user.credits > 0 && plural(t.alsoCredits, user.credits)}
        </p>

        {pago === "ok" && (
          <p className="om-card mb-8 border-clay px-6 py-4 text-[16px] text-ink-soft">
            {t.paidOk}
          </p>
        )}
        {pago === "cancelado" && (
          <p className="om-card mb-8 px-6 py-4 text-[16px] text-muted">{t.paidCancelled}</p>
        )}

        <div className="mb-14 mt-10">
          <PlanCards currentPlan={user.plan} lang={lang} />
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-6">
          <Checkout paymentsEnabled={stripeConfigured()} t={t} />

          <div className="om-card px-7 py-[30px]">
            <div className="om-label mb-5">{t.ledgerTitle}</div>
            {ledger.length === 0 ? (
              <p className="text-[15px] text-muted">{t.ledgerEmpty}</p>
            ) : (
              <div className="flex flex-col">
                {ledger.map((l, i) => (
                  <div
                    key={l.id}
                    className={`flex items-center gap-4 py-[14px] ${i ? "border-t border-line-hair" : ""}`}
                  >
                    <div className="mr-auto min-w-0">
                      <div className="truncate text-[16px]">{ledgerReason(lang, l)}</div>
                      <div className="mt-0.5 text-[13px] text-faint">
                        {formatDate(l.created_at, lang)}
                      </div>
                    </div>
                    <span
                      className={`flex-none text-[16px] tabular-nums ${
                        l.delta > 0 ? "text-clay" : "text-faint"
                      }`}
                    >
                      {l.delta > 0 ? `+${l.delta}` : l.delta}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
