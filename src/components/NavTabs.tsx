"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

/** La misma regla de pestaña activa para el nav de escritorio y el de móvil. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function NavTabs({ items, className = "" }: { items: NavItem[]; className?: string }) {
  const pathname = usePathname();

  return (
    <nav className={`items-center gap-[3px] ${className}`}>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-[13px] py-2 text-[14px] transition-colors ${
              active ? "bg-[#e7dccb] text-ink" : "text-muted-soft hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
