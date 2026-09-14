import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { VoiceGrid } from "./VoiceGrid";
import { SiteFooter } from "@/components/SiteFooter";
import { currentUser } from "@/lib/auth";
import { listVoices } from "@/lib/queries";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: copy(await getLang()).meta.titles.voices };
}

export default async function VocesPage({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>;
}) {
  const [user, voices, { volver }, lang] = await Promise.all([
    currentUser(),
    listVoices(),
    searchParams,
    getLang(),
  ]);

  const t = copy(lang).voices;

  // Solo aceptamos rutas internas como destino de vuelta.
  const returnTo = volver?.startsWith("/") && !volver.startsWith("//") ? volver : null;

  return (
    <main>
      <div className="om-shell pb-24 pt-14">
        {returnTo && (
          <Link href={returnTo} className="mb-[22px] block text-[14px] text-muted-soft hover:text-ink">
            {t.back}
          </Link>
        )}

        <p className="om-eyebrow mb-[10px]">{t.eyebrow}</p>
        <h1 className="mb-3 text-[clamp(28px,4vw,40px)]">{t.title}</h1>
        <p className="mb-10 max-w-[52ch] text-[17px] leading-[1.6] text-muted">{t.body}</p>

        {voices.length === 0 ? (
          <p className="om-card px-6 py-8 text-[16px] leading-[1.6] text-muted">
            {t.emptyBefore}
            <code className="font-mono text-[14px] text-clay">npm run seed</code>
            {t.emptyBetween}
            <code className="font-mono text-[14px] text-clay">npm run voices:link</code>
            {t.emptyAfter}
          </p>
        ) : (
          <Suspense fallback={null}>
            <VoiceGrid
              voices={voices}
              selectedId={user?.default_voice_id ?? null}
              returnTo={returnTo}
              lang={lang}
              t={t}
            />
          </Suspense>
        )}
      </div>

      <SiteFooter />
    </main>
  );
}
