import Image from "next/image";
import Link from "next/link";
import { Wave } from "@/components/Wave";
import { BreathCircle } from "@/components/BreathCircle";
import { LaunchVideo } from "@/components/LaunchVideo";
import { Faq } from "@/components/Faq";
import { SiteFooter } from "@/components/SiteFooter";
import { currentUser } from "@/lib/auth";
import { planOutline, sectionMinutes } from "@/lib/session-plan";
import { breathingSlotSeconds } from "@/lib/breathing";
import { getLang } from "@/lib/lang";
import { copy, sectionLabel } from "@/lib/i18n";

export default async function LandingPage() {
  const [user, lang] = await Promise.all([currentUser(), getLang()]);
  const t = copy(lang);
  // La portada muestra el reparto con una respiración genérica: el ejercicio
  // concreto se elige al personalizar, pero el hueco que ocupa es este.
  const anatomy = planOutline(15, {
    label: "Respiración guiada",
    seconds: breathingSlotSeconds(15),
  });

  return (
    <main>
      <div className="om-shell">
        {/* Hero */}
        <section className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-center gap-14 pb-[76px] pt-[92px]">
          <div>
            <p className="om-eyebrow mb-6">{t.hero.eyebrow}</p>
            <h1 className="mb-6 text-[clamp(38px,5vw,62px)] leading-[1.06]">{t.hero.title}</h1>
            <p className="mb-9 max-w-[46ch] text-[19px] leading-[1.6] text-muted">{t.hero.body}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={user ? "/home" : "/acceso?modo=crear"} className="om-btn om-btn-solid">
                {user ? t.hero.ctaHome : t.hero.ctaSignUp}
              </Link>
              <Link href="/catalogo" className="om-btn om-btn-ghost">
                {t.hero.ctaListen}
              </Link>
            </div>
            <p className="mt-[18px] text-[14px] text-faint">{t.hero.note}</p>
          </div>

          <BreathCircle>
            <Wave count={44} height={70} animate className="w-full" />
          </BreathCircle>
        </section>

        {/* Video */}
        <section>
          <div className="mb-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
            <div>
              <p className="om-eyebrow mb-[14px]">{t.video.eyebrow}</p>
              <h2 className="text-[clamp(26px,3.4vw,36px)]">{t.video.title}</h2>
            </div>
            <p className="max-w-[46ch] text-[17px] leading-[1.6] text-muted">{t.video.body}</p>
          </div>
          <LaunchVideo t={t.video} />
          <p className="mt-3 font-mono text-[13px] text-faint">{t.video.caption}</p>
        </section>

        {/* Tres pasos */}
        <section className="mt-24 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
          {t.steps.map((s) => (
            <div key={s.n} className="bg-paper px-7 py-8">
              <div className="mb-[14px] text-[12px] uppercase tracking-[0.18em] text-clay">
                {s.n} — {s.title}
              </div>
              <p className="text-[16px] leading-[1.6] text-ink-soft">{s.body}</p>
            </div>
          ))}
        </section>

        {/* Respiración */}
        <section className="mt-24 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-center gap-12">
          <div>
            <p className="om-eyebrow mb-[18px]">{t.breathing.eyebrow}</p>
            <h2 className="mb-[18px] text-[clamp(26px,3.4vw,36px)]">{t.breathing.title}</h2>
            <p className="max-w-[50ch] text-[17px] leading-[1.65] text-muted">{t.breathing.body}</p>
          </div>

          <div className="om-card px-[30px] py-[34px]">
            <div className="om-label mb-[22px]">{t.breathing.cardTitle}</div>
            <div className="flex flex-col gap-[14px]">
              {anatomy.map((s) => (
                <div key={s.key} className="flex items-center gap-[14px]">
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{
                      background:
                        s.kind === "dynamic" ? "var(--color-clay)" : "var(--color-clay-bar)",
                    }}
                  />
                  <span className="mr-auto text-[16px]">{sectionLabel(lang, s.label)}</span>
                  <span className="text-[14px] text-faint">
                    {sectionMinutes(s)} {t.common.minutes}
                  </span>
                </div>
              ))}
            </div>
            <div className="my-[22px] h-px bg-line-hair" />
            <p className="text-[14px] leading-[1.55] text-faint">{t.breathing.cardNote}</p>
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-24 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-12">
          <div>
            <p className="om-eyebrow mb-[14px]">{t.faq.eyebrow}</p>
            <h2 className="text-[clamp(26px,3.4vw,36px)]">{t.faq.title}</h2>
          </div>
          <Faq items={t.faq.items} />
        </section>

        {/* YouTube */}
        <section
          id="youtube"
          className="mt-24 grid scroll-mt-24 grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-center gap-10 rounded-card bg-ink p-[clamp(36px,5vw,64px)]"
        >
          <div>
            <p className="mb-4 text-[13px] uppercase tracking-[0.2em] text-night-muted">
              {t.youtube.eyebrow}
            </p>
            <h2 className="mb-[14px] text-[clamp(26px,3.2vw,34px)] text-sand">{t.youtube.title}</h2>
            <p className="max-w-[46ch] text-[17px] leading-[1.6] text-night-text">
              {t.youtube.body}
            </p>
          </div>

          <div className="flex flex-col items-start gap-3">
            <div className="relative flex aspect-video w-full items-center justify-center rounded-[3px] border border-night-line bg-night px-[14%]">
              <Image
                src="/brand/omtana-wordmark-white.svg"
                alt="Omtana"
                width={54}
                height={11}
                className="absolute left-[18px] top-[18px] h-[11px] w-auto opacity-50"
              />
              <Wave count={40} height={46} color="var(--color-night-bar)" animate className="w-full" />
            </div>
            <p className="font-mono text-[13px] text-[#8b8074]">{t.youtube.caption}</p>
          </div>
        </section>

        {/* Cierre */}
        <section className="mt-24 text-center">
          <p className="om-eyebrow mb-[14px]">{t.closing.eyebrow}</p>
          <h2 className="mx-auto mb-4 max-w-[20ch] text-[clamp(26px,3.4vw,36px)]">
            {t.closing.title}
          </h2>
          <p className="mx-auto mb-9 max-w-[52ch] text-[17px] leading-[1.6] text-muted">
            {t.closing.body}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href={user ? "/home" : "/acceso?modo=crear"} className="om-btn om-btn-solid">
              {user ? t.hero.ctaHome : t.hero.ctaSignUp}
            </Link>
            <Link href="/catalogo" className="om-btn om-btn-ghost">
              {t.hero.ctaListen}
            </Link>
          </div>
          <p className="mt-[18px] text-[14px] text-faint">{t.closing.note}</p>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
