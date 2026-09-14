import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { LibraryList } from "./LibraryList";
import { SiteFooter } from "@/components/SiteFooter";
import { currentUser } from "@/lib/auth";
import { listUserMeditations, listVoices } from "@/lib/queries";
import { getLang } from "@/lib/lang";
import { copy, plural } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: copy(await getLang()).meta.titles.library };
}

export default async function BibliotecaPage() {
  const user = await currentUser();
  if (!user) redirect("/acceso");

  const [meditations, voices, lang] = await Promise.all([
    listUserMeditations(user.id),
    listVoices(),
    getLang(),
  ]);

  const voiceNames = Object.fromEntries(voices.map((v) => [v.id, v.name]));
  const count = meditations.length;
  const t = copy(lang).library;

  return (
    <main>
      <div className="om-shell pb-24 pt-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="om-eyebrow mb-[10px]">{t.eyebrow}</p>
            <h1 className="text-[clamp(28px,4vw,40px)]">
              {count === 0 ? t.titleEmpty : plural(t.titleCount, count)}
            </h1>
          </div>
          <Link href="/home" className="om-btn om-btn-solid px-6 py-[13px] text-[15px]">
            {t.newCta}
          </Link>
        </div>

        {count === 0 ? (
          <p className="om-card px-6 py-8 text-[16px] leading-[1.6] text-muted">
            {t.emptyBefore}
            <Link href="/home">{t.emptyLink}</Link>
            {t.emptyAfter}
          </p>
        ) : (
          <LibraryList
            meditations={meditations}
            voiceNames={voiceNames}
            lang={lang}
            t={t}
          />
        )}

        <p className="mt-7 max-w-[58ch] text-[14px] leading-[1.6] text-faint">{t.note}</p>
      </div>

      <SiteFooter />
    </main>
  );
}
