import Image from "next/image";
import Link from "next/link";
import { paymentsEnabled } from "@/lib/payments";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";

export async function SiteFooter() {
  const t = copy(await getLang()).footer;

  const columns = [
    {
      title: t.columns.product,
      links: [
        { label: t.links.howItWorks, href: "/" },
        { label: t.links.voices, href: "/voces" },
        // Sin pagos configurados no hay plan que elegir: la entrada desaparece
        // en vez de llevar a una página que no ofrece nada.
        ...(paymentsEnabled() ? [{ label: t.links.plans, href: "/planes" }] : []),
        { label: t.links.youtube, href: "/#youtube" },
      ],
    },
    {
      title: t.columns.account,
      links: [
        { label: t.links.signIn, href: "/acceso" },
        { label: t.links.signUp, href: "/acceso?modo=crear" },
        { label: t.links.library, href: "/biblioteca" },
        { label: t.links.profile, href: "/perfil" },
      ],
    },
    {
      title: t.columns.legal,
      links: [
        { label: t.terms, href: "/terminos" },
        { label: t.privacy, href: "/terminos#datos" },
        { label: "hola@omtana.com", href: "mailto:hola@omtana.com" },
      ],
    },
  ];

  return (
    <footer className="mt-24 border-t border-line bg-sand-deep">
      <div className="om-shell grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-10 pb-10 pt-14">
        <div>
          <Image
            src="/brand/omtana-wordmark-black.svg"
            alt="Omtana"
            width={82}
            height={17}
            className="mb-4 block h-[17px] w-auto"
          />
          <p className="max-w-[30ch] text-[14px] leading-[1.6] text-muted-soft">{t.tagline}</p>
        </div>

        {columns.map((col) => (
          <div key={col.title}>
            <div className="mb-4 text-[12px] uppercase tracking-[0.18em] text-faint">
              {col.title}
            </div>
            <div className="flex flex-col items-start gap-[10px]">
              {col.links.map((l) => (
                <Link key={l.label} href={l.href} className="text-[15px] text-ink-soft hover:text-clay">
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="om-shell flex flex-wrap gap-5 pb-12 text-[14px] text-faint">
        <span>{t.copyright}</span>
        <Link href="/terminos" className="text-faint hover:text-ink">{t.terms}</Link>
        <Link href="/terminos#datos" className="text-faint hover:text-ink">{t.privacy}</Link>
        <span className="ml-auto">{t.languages}</span>
      </div>
    </footer>
  );
}
