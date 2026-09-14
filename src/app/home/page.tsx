import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { listIntentions, recentForUser, remainingFree } from "@/lib/queries";
import { IntentionInput } from "@/components/IntentionInput";
import { IntentionBank, type BankArea, type BankCard } from "@/components/IntentionBank";
import { MeditationRow } from "@/components/MeditationRow";
import { SiteFooter } from "@/components/SiteFooter";
import { paymentsEnabled } from "@/lib/payments";
import { greeting, formatDuration, formatDate } from "@/lib/format";
import { PLAN } from "@/lib/config";
import { getLang } from "@/lib/lang";
import { areaLabel, copy, fill, localized } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: copy(await getLang()).meta.titles.home };
}

export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect("/acceso");

  const [intentions, recent, lang] = await Promise.all([
    listIntentions(),
    recentForUser(user.id),
    getLang(),
  ]);

  const t = copy(lang);
  const left = remainingFree(user);
  // Sin pagos no hay tope ni plan que mirar, así que el contador desaparece.
  const quota = !paymentsEnabled()
    ? null
    : user.plan === "pro"
      ? t.home.quotaPro
      : fill(t.home.quotaFree, {
          used: PLAN.free.monthlyCustomizations - left,
          total: PLAN.free.monthlyCustomizations,
        });

  const cards: BankCard[] = intentions.map((it) => {
    const title = localized(it, lang, "title");
    return {
      id: it.id,
      href: `/personalizar?intencion=${encodeURIComponent(title)}&i=${it.slug}`,
      title,
      summary: localized(it, lang, "summary"),
      tag: localized(it, lang, "tag"),
      area: it.category,
      meta: `${it.durations.join(" · ")} ${t.common.minutes}`,
    };
  });

  // El orden de las áreas es el del banco, no uno fijo: así el seed manda.
  const areas: BankArea[] = [...new Set(cards.map((c) => c.area))].map((value) => ({
    value,
    label: areaLabel(lang, value),
  }));

  return (
    <main>
      <div className="om-shell pb-24 pt-14">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="om-eyebrow mb-[10px]">
              {greeting(lang)}, {user.name.split(" ")[0]}
            </p>
            <h1 className="text-[clamp(30px,4vw,42px)]">{t.home.title}</h1>
          </div>
          {quota && (
            <Link
              href="/planes"
              className="rounded-full border border-line-field bg-paper px-4 py-[9px] text-[14px] text-muted hover:border-clay-tint"
            >
              {quota}
            </Link>
          )}
        </div>

        <IntentionInput t={t.intentionInput} />

        <div className="mb-[18px] flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="m-0 text-[14px] font-medium uppercase tracking-[0.18em] text-muted-soft">
            {t.home.bankTitle}
          </h2>
          <span className="text-[14px] text-muted-soft">{t.home.bankNote}</span>
        </div>

        {intentions.length === 0 ? (
          <p className="om-card mb-14 px-6 py-8 text-[16px] leading-[1.6] text-muted">
            {t.home.bankEmptyBefore}
            <code className="font-mono text-[14px] text-clay">npm run seed</code>
            {t.home.bankEmptyAfter}
          </p>
        ) : (
          <IntentionBank cards={cards} areas={areas} allLabel={t.home.bankAll} />
        )}

        {recent.length > 0 && (
          <>
            <h2 className="m-0 mb-[18px] text-[14px] font-medium uppercase tracking-[0.18em] text-muted-soft">
              {t.home.continueTitle}
            </h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-[14px]">
              {recent.map((m) => (
                <MeditationRow
                  key={m.id}
                  meditation={m}
                  lang={lang}
                  meta={`${formatDuration(m.duration_seconds, lang)} · ${formatDate(m.created_at, lang)}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <SiteFooter />
    </main>
  );
}
