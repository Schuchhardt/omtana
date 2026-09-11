import Link from "next/link";
import { Logo } from "./Logo";
import { NavTabs, type NavItem } from "./NavTabs";
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

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-sand/93 backdrop-blur-[12px]">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-5 px-6 py-3">
        <Logo href={user ? "/home" : "/"} />
        <NavTabs items={user ? SIGNED_IN : SIGNED_OUT} />

        {user ? (
          <form action="/api/auth/logout" method="post" className="flex-none border-l border-line pl-[14px]">
            <button type="submit" className="cursor-pointer px-1.5 py-1.5 text-[13px] tracking-[0.08em] text-faint-soft hover:text-ink">
              SALIR
            </button>
          </form>
        ) : (
          <div className="flex flex-none items-center gap-1 border-l border-line pl-[14px]">
            <Link href="/acceso" className="px-[10px] py-1.5 text-[14px] text-muted-soft hover:text-ink">
              Entrar
            </Link>
            <Link href="/acceso?modo=crear" className="om-btn om-btn-solid om-btn-sm">
              Crear cuenta
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
