"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

/**
 * Banco de intenciones con filtro por área de vida.
 *
 * El banco cubre la misma necesidad — dormir, ansiedad, foco — en trabajo,
 * dinero, salud, relaciones y comunidad, así que la lista completa es larga y
 * sin filtro no se lee. Las tarjetas ya vienen traducidas y armadas desde el
 * servidor: acá solo se eligen cuáles se muestran.
 */
export interface BankCard {
  id: string;
  href: string;
  title: string;
  summary: string;
  tag: string;
  area: string;
  meta: string;
}

export interface BankArea {
  value: string;
  label: string;
}

const ALL = "__all__";

export function IntentionBank({
  cards,
  areas,
  allLabel,
}: {
  cards: BankCard[];
  areas: BankArea[];
  allLabel: string;
}) {
  const [area, setArea] = useState(ALL);

  // Si el área elegida desaparece del banco, se vuelve a mostrar todo.
  const active = areas.some((a) => a.value === area) ? area : ALL;
  const shown = active === ALL ? cards : cards.filter((c) => c.area === active);

  return (
    <>
      {areas.length > 1 && (
        <div className="mb-[18px] flex flex-wrap gap-2">
          {[{ value: ALL, label: allLabel }, ...areas].map((a) => (
            <button
              key={a.value}
              type="button"
              aria-pressed={a.value === active}
              onClick={() => setArea(a.value)}
              className={
                a.value === active
                  ? "cursor-pointer rounded-full border border-clay bg-clay px-[14px] py-1.5 text-[14px] text-paper transition-colors"
                  : "cursor-pointer rounded-full border border-line-field bg-transparent px-[14px] py-1.5 text-[14px] text-ink-soft transition-colors hover:border-clay-tint"
              }
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="mb-14 grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-[14px]">
        {shown.map((card) => (
          <Link
            key={card.id}
            href={card.href}
            className="om-card flex min-h-[196px] flex-col px-6 pb-[22px] pt-[26px] transition-all hover:-translate-y-0.5 hover:border-clay-tint"
          >
            <div className="flex items-center justify-between">
              <Image
                src="/brand/omtana-symbol-black.svg"
                alt=""
                width={26}
                height={26}
                className="block h-[26px] w-[26px] opacity-[0.32]"
              />
              <span className="text-[12px] uppercase tracking-[0.14em] text-faint-soft">
                {card.tag}
              </span>
            </div>
            <div className="mt-[26px] text-[20px] tracking-[-0.01em]">{card.title}</div>
            {card.summary && (
              <p className="m-0 mt-2 text-[14px] leading-[1.5] text-muted">{card.summary}</p>
            )}
            <div className="mt-auto pt-[14px] text-[14px] text-muted-soft">{card.meta}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
