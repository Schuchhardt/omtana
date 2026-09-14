import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { listIntentions, recentForUser, remainingFree } from "@/lib/queries";
import { IntentionInput } from "@/components/IntentionInput";
import { MeditationRow } from "@/components/MeditationRow";
import { SiteFooter } from "@/components/SiteFooter";
import { greeting, formatDuration, formatDate } from "@/lib/format";
import { PLAN } from "@/lib/config";
import { getLang } from "@/lib/lang";
import { copy, fill, localized } from "@/lib/i18n";

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
  const quota =
    user.plan === "pro"
      ? t.home.quotaPro
      : fill(t.home.quotaFree, {
          used: PLAN.free.monthlyCustomizations - left,
          total: PLAN.free.monthlyCustomizations,
        });

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
          <Link
            href="/planes"
            className="rounded-full border border-line-field bg-paper px-4 py-[9px] text-[14px] text-muted hover:border-clay-tint"
          >
            {quota}
          </Link>
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
          <div className="mb-14 grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-[14px]">
            {intentions.map((it) => (
              <Link
                key={it.id}
                href={`/personalizar?intencion=${encodeURIComponent(localized(it, lang, "title"))}&i=${it.slug}`}
                className="om-card flex min-h-[176px] flex-col px-6 pb-[22px] pt-[26px] transition-all hover:-translate-y-0.5 hover:border-clay-tint"
              >
                <div className="mb-auto flex items-center justify-between">
                  <Image
                    src="/brand/omtana-symbol-black.svg"
                    alt=""
                    width={26}
                    height={26}
                    className="block h-[26px] w-[26px] opacity-[0.32]"
                  />
                  <span className="text-[12px] uppercase tracking-[0.14em] text-faint-soft">
                    {localized(it, lang, "tag")}
                  </span>
                </div>
                <div className="mt-[26px] text-[20px] tracking-[-0.01em]">
                  {localized(it, lang, "title")}
                </div>
                <div className="mt-1.5 text-[14px] text-muted-soft">
                  {it.durations.join(" · ")} {t.common.minutes}
                </div>
              </Link>
            ))}
          </div>
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
