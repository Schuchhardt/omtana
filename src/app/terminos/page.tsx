import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { getLang } from "@/lib/lang";
import { copy, fill } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: copy(await getLang()).meta.titles.terms };
}

export default async function TerminosPage() {
  const t = copy(await getLang());
  const page = t.termsPage;

  return (
    <main>
      <div className="om-shell grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] items-start gap-14 pb-24 pt-14">
        <aside className="sticky top-[88px] max-w-[280px]">
          <p className="om-eyebrow mb-[14px]">{page.eyebrow}</p>
          <h1 className="mb-[10px] text-[30px]">{page.title}</h1>
          <p className="mb-7 text-[14px] text-faint">
            {fill(page.updated, { date: t.terms.updated })}
          </p>
          <nav className="flex flex-col items-start gap-[10px]">
            {t.terms.sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="text-[15px] text-muted hover:text-clay">
                {s.title}
              </a>
            ))}
          </nav>
        </aside>

        <div className="om-prose max-w-[68ch] [grid-column:span_2]">
          {t.terms.sections.map((s) => (
            <section key={s.id} id={s.id} className="mb-10 scroll-mt-24">
              <h2 className="mb-3 text-[20px] font-medium tracking-[-0.01em]">{s.title}</h2>
              {s.paragraphs.map((p) => (
                <p key={p.slice(0, 40)}>{p}</p>
              ))}
            </section>
          ))}

          <div className="om-card px-6 py-[26px] text-[15px] leading-[1.65] text-muted">
            {page.contactBefore}
            <a href="mailto:hola@omtana.com">hola@omtana.com</a>
            {page.contactAfter}
          </div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
