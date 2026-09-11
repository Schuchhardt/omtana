import Image from "next/image";
import Link from "next/link";

const COLUMNS = [
  {
    title: "Producto",
    links: [
      { label: "Cómo funciona", href: "/" },
      { label: "Banco de voces", href: "/voces" },
      { label: "Planes y créditos", href: "/planes" },
      { label: "Canal de YouTube", href: "/#youtube" },
    ],
  },
  {
    title: "Cuenta",
    links: [
      { label: "Entrar", href: "/acceso" },
      { label: "Crear cuenta", href: "/acceso?modo=crear" },
      { label: "Mi biblioteca", href: "/biblioteca" },
      { label: "Mi perfil", href: "/perfil" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Términos y condiciones", href: "/terminos" },
      { label: "Privacidad", href: "/terminos#datos" },
      { label: "hola@omtana.com", href: "mailto:hola@omtana.com" },
    ],
  },
];

export function SiteFooter() {
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
          <p className="max-w-[30ch] text-[14px] leading-[1.6] text-muted-soft">
            Meditaciones generadas a partir de tu intención. Santiago, Chile.
          </p>
        </div>

        {COLUMNS.map((col) => (
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
        <span>© 2026 Omtana</span>
        <Link href="/terminos" className="text-faint hover:text-ink">Términos y condiciones</Link>
        <Link href="/terminos#datos" className="text-faint hover:text-ink">Privacidad</Link>
        <span className="ml-auto">Español · English · Português</span>
      </div>
    </footer>
  );
}
