import Link from "next/link";
import { Logo } from "./Logo";
import { NavTabs, type NavItem } from "./NavTabs";
import { MobileMenu } from "./MobileMenu";
import { currentUser } from "@/lib/auth";

const SIGNED_IN: NavItem[] = [
  { href: "/home", label: "Inicio" },
  { href: "/personalizar", label: "Personalizar" },
  { href: "/voces", label: "Voces" },
  { href: "/biblioteca", label: "Biblioteca" },
  { href: "/planes", label: "Planes" },
  { href: "/perfil", label: "Perfil" },
];

const SIGNED_OUT: NavItem[] = [
  { href: "/", label: "Cómo funciona" },
  { href: "/voces", label: "Voces" },
  { href: "/planes", label: "Planes" },
];

export async function SiteHeader() {
  const user = await currentUser();
  const items = user ? SIGNED_IN : SIGNED_OUT;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-sand/93 backdrop-blur-[12px]">
      {/* Altura fija: el reproductor la descuenta para ocupar la pantalla justa. */}
      <div className="mx-auto flex h-[var(--om-header-h)] max-w-[1180px] items-center gap-5 px-6">
        <Logo href={user ? "/home" : "/"} />

        <NavTabs items={items} className="hidden lg:flex" />

        {user ? (
          <form
            action="/api/auth/logout"
            method="post"
            className="hidden flex-none border-l border-line pl-[14px] lg:block"
          >
            <button
              type="submit"
              className="cursor-pointer px-1.5 py-1.5 text-[13px] tracking-[0.08em] text-faint-soft hover:text-ink"
            >
              SALIR
            </button>
          </form>
        ) : (
          <div className="hidden flex-none items-center gap-1 border-l border-line pl-[14px] lg:flex">
            <Link href="/acceso" className="px-[10px] py-1.5 text-[14px] text-muted-soft hover:text-ink">
              Entrar
            </Link>
            <Link href="/acceso?modo=crear" className="om-btn om-btn-solid om-btn-sm">
              Crear cuenta
            </Link>
          </div>
        )}

        <MobileMenu items={items} signedIn={!!user} />
      </div>
    </header>
  );
}
