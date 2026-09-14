import Link from "next/link";
import type { Metadata } from "next";
import { MeditationRow } from "@/components/MeditationRow";
import { SiteFooter } from "@/components/SiteFooter";
import { listCatalog, listVoices } from "@/lib/queries";
import { formatDuration, plays as playsLabel } from "@/lib/format";
import { LOCALES } from "@/lib/config";
import { getLang } from "@/lib/lang";
import { copy, fill, plural } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: copy(await getLang()).meta.titles.catalog };
}

const ALL = "todas";

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ idioma?: string }>;
}) {
  const [{ idioma }, lang, voices] = await Promise.all([searchParams, getLang(), listVoices()]);
  const t = copy(lang).catalog;

  const known = LOCALES.some((l) => l.code === idioma);
  // Sin parámetro se muestra el idioma de la interfaz, que es la apuesta más
  // probable; con parámetro manda lo que la persona eligió.
  const asked = idioma === ALL ? null : known ? idioma! : lang;
  const explicit = idioma === ALL || known;

  let catalog = await listCatalog(undefined, asked ?? undefined);

  // Un catálogo vacío es peor que uno en otro idioma: si todavía no hay nada en
  // el idioma de la interfaz, se muestran todas y se dice por qué.
  const fellBack = !explicit && catalog.length === 0;
  if (fellBack) catalog = await listCatalog();

  const selected = fellBack ? ALL : (asked ?? ALL);
  const mixed = selected === ALL;
  const voiceNames = Object.fromEntries(voices.map((v) => [v.id, v.name]));
  const languageNames = Object.fromEntries(LOCALES.map((l) => [l.code, l.meditationLabel]));

  const filters = [{ code: ALL, label: t.filterAll }, ...LOCALES.map((l) => ({ code: l.code, label: l.meditationLabel }))];

  return (
    <main>
      <div className="om-shell pb-24 pt-14">
        <p className="om-eyebrow mb-[10px]">{t.eyebrow}</p>
        <h1 className="mb-3 text-[clamp(28px,4vw,40px)]">{t.title}</h1>
        <p className="mb-7 max-w-[52ch] text-[17px] leading-[1.6] text-muted">{t.body}</p>

        {catalog.length > 0 && (
          <p className="mb-4 text-[14px] text-faint">
            {plural(t.count, catalog.length)}
          </p>
        )}

        <nav aria-label={t.languageLabel} className="mb-8 flex flex-wrap gap-[10px]">
          {filters.map((f) => (
            <Link
              key={f.code}
              href={`/catalogo?idioma=${f.code}`}
              data-active={selected === f.code}
              aria-current={selected === f.code ? "page" : undefined}
              className="om-pill inline-flex items-center"
            >
              {f.label}
            </Link>
          ))}
        </nav>

        {fellBack && (
          <p className="mb-6 text-[15px] leading-[1.6] text-faint">
            {fill(t.fallbackNote, { language: languageNames[lang] })}
          </p>
        )}

        {catalog.length === 0 ? (
          <p className="om-card px-6 py-8 text-[16px] leading-[1.6] text-muted">
            {explicit ? (
              <>
                {t.emptyFilter} <Link href={`/catalogo?idioma=${ALL}`}>{t.seeAll}</Link>.
              </>
            ) : (
              <>
                {t.emptyBefore}
                <code className="font-mono text-[14px] text-clay">npm run generate -- --curated</code>
                {t.emptyAfter}
              </>
            )}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-[14px]">
            {catalog.map((m) => (
              <MeditationRow
                key={m.id}
                meditation={m}
                lang={lang}
                // En la vista mezclada el idioma de cada sesión va en la ficha:
                // el título ya viene en ese idioma y sin la etiqueta no se sabe.
                meta={[
                  formatDuration(m.duration_seconds, lang),
                  mixed ? (languageNames[m.locale] ?? m.locale.toUpperCase()) : null,
                  m.voice_id ? (voiceNames[m.voice_id] ?? "Omtana") : null,
                  playsLabel(m.plays, lang),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </div>
        )}

        <p className="mt-10 text-[15px] text-muted">
          {t.ctaBefore}
          <Link href="/acceso?modo=crear">{t.ctaLink}</Link>
          {t.ctaAfter}
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
