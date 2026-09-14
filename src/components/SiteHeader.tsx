import Link from "next/link";
import { Logo } from "./Logo";
import { NavTabs, type NavItem } from "./NavTabs";
import { MobileMenu } from "./MobileMenu";
import { LangSwitch } from "./LangSwitch";
import { currentUser } from "@/lib/auth";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";

export async function SiteHeader() {
  const [user, lang] = await Promise.all([currentUser(), getLang()]);
  const t = copy(lang);

  // Planes no está acá a propósito: el nav es para lo que se usa a diario y la
  // entrada a planes vive en el pie (y en el perfil, para quien la busca).
  const items: NavItem[] = user
    ? [
        { href: "/home", label: t.nav.home },
        { href: "/personalizar", label: t.nav.customize },
        { href: "/voces", label: t.nav.voices },
        { href: "/biblioteca", label: t.nav.library },
        { href: "/perfil", label: t.nav.profile },
      ]
    : [
        { href: "/", label: t.nav.howItWorks },
        { href: "/voces", label: t.nav.voices },
      ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-sand/93 backdrop-blur-[12px]">
      {/* Altura fija: el reproductor la descuenta para ocupar la pantalla justa. */}
      <div className="mx-auto flex h-[var(--om-header-h)] max-w-[1180px] items-center gap-5 px-6">
        <Logo href={user ? "/home" : "/"} />

        <NavTabs items={items} className="hidden lg:flex" />

        <div className="hidden flex-none items-center gap-1 lg:flex">
          <LangSwitch lang={lang} label={t.langSwitchLabel} />

          {user ? (
            <form action="/api/auth/logout" method="post" className="border-l border-line pl-[14px]">
              <button
                type="submit"
                className="cursor-pointer px-1.5 py-1.5 text-[13px] tracking-[0.08em] text-faint-soft hover:text-ink"
              >
                {t.nav.signOutShort}
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-1 border-l border-line pl-[14px]">
              <Link href="/acceso" className="px-[10px] py-1.5 text-[14px] text-muted-soft hover:text-ink">
                {t.nav.signIn}
              </Link>
              <Link href="/acceso?modo=crear" className="om-btn om-btn-solid om-btn-sm">
                {t.nav.signUp}
              </Link>
            </div>
          )}
        </div>

        <MobileMenu items={items} signedIn={!!user} lang={lang} labels={t.nav} switchLabel={t.langSwitchLabel} />
      </div>
    </header>
  );
}
