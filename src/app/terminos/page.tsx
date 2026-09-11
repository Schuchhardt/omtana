import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { TERMS, TERMS_UPDATED } from "@/lib/terms";

export const metadata: Metadata = { title: "Términos y condiciones" };

export default function TerminosPage() {
  return (
    <main>
      <div className="om-shell grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] items-start gap-14 pb-24 pt-14">
        <aside className="sticky top-[88px] max-w-[280px]">
          <p className="om-eyebrow mb-[14px]">Legal</p>
          <h1 className="mb-[10px] text-[30px]">Términos y condiciones</h1>
          <p className="mb-7 text-[14px] text-faint">Última actualización: {TERMS_UPDATED}</p>
          <nav className="flex flex-col items-start gap-[10px]">
            {TERMS.map((t) => (
              <a key={t.id} href={`#${t.id}`} className="text-[15px] text-muted hover:text-clay">
                {t.title}
              </a>
            ))}
          </nav>
        </aside>

        <div className="om-prose max-w-[68ch] [grid-column:span_2]">
          {TERMS.map((t) => (
            <section key={t.id} id={t.id} className="mb-10 scroll-mt-24">
              <h2 className="mb-3 text-[20px] font-medium tracking-[-0.01em]">{t.title}</h2>
              {t.paragraphs.map((p) => (
                <p key={p.slice(0, 40)}>{p}</p>
              ))}
            </section>
          ))}

          <div className="om-card px-6 py-[26px] text-[15px] leading-[1.65] text-muted">
            Si algo de esto no queda claro, escríbenos a{" "}
            <a href="mailto:hola@omtana.com">hola@omtana.com</a> antes de aceptar.
            Preferimos responder una pregunta a que aceptes algo que no entiendes.
          </div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
