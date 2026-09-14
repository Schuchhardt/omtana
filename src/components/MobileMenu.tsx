"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { isActive, type NavItem } from "./NavTabs";

/**
 * El nav de la cabecera cuando no caben las pestañas.
 *
 * Con sesión son seis pestañas más el logo y el salir: en un teléfono eso se
 * partía en tres filas de cabecera pegajosa, un quinto de la pantalla ocupado en
 * todas las vistas. Acá el mismo nav vive detrás de un botón.
 */
export function MobileMenu({ items, signedIn }: { items: NavItem[]; signedIn: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // Navegar cierra el menú: el destino ya se está pintando detrás. Se ajusta
  // durante el render en vez de en un efecto, así también cierra al volver con
  // el botón atrás y no deja un frame con el menú abierto sobre la página nueva.
  const [renderedPath, setRenderedPath] = useState(pathname);
  if (renderedPath !== pathname) {
    setRenderedPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Cerrar menú" : "Abrir menú"}
        className="-mr-[10px] flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-full text-ink lg:hidden"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {open ? (
            <>
              <path d="M5.5 5.5l11 11" />
              <path d="M16.5 5.5l-11 11" />
            </>
          ) : (
            <>
              <path d="M3 6.5h16" />
              <path d="M3 11h16" />
              <path d="M3 15.5h16" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute inset-x-0 top-full max-h-[calc(100svh-var(--om-header-h))] overflow-y-auto border-b border-line bg-sand shadow-[0_12px_28px_-18px_rgba(36,31,26,0.4)] lg:hidden"
        >
          <div className="om-shell flex flex-col py-3">
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-[48px] items-center rounded-card px-3 text-[17px] ${
                    active ? "bg-[#e7dccb] text-ink" : "text-ink-soft"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}

            <div className="my-3 h-px bg-line-hair" />

            {signedIn ? (
              <form action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  className="flex min-h-[48px] w-full cursor-pointer items-center rounded-card px-3 text-left text-[17px] text-muted"
                >
                  Salir
                </button>
              </form>
            ) : (
              <div className="flex flex-col gap-2 pb-1">
                <Link
                  href="/acceso"
                  className="flex min-h-[48px] items-center rounded-card px-3 text-[17px] text-ink-soft"
                >
                  Entrar
                </Link>
                <Link href="/acceso?modo=crear" className="om-btn om-btn-solid w-full py-[14px]">
                  Crear cuenta
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
