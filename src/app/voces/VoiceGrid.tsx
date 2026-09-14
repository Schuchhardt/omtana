"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Wave } from "@/components/Wave";
import { fill, localized, voiceGender, voiceTone, type Copy, type UiLang } from "@/lib/i18n";
import type { Voice } from "@/lib/types";

/**
 * Los filtros comparan contra los valores tal como están en la base, que están
 * en español; solo el rótulo cambia de idioma. Así el filtro elegido sigue
 * valiendo cuando alguien cambia de idioma a media página.
 */
const FILTERS: { id: string; match: (v: Voice) => boolean }[] = [
  { id: "all", match: () => true },
  { id: "es", match: (v) => v.languages.includes("es") },
  { id: "en", match: (v) => v.languages.includes("en") },
  { id: "pt", match: (v) => v.languages.includes("pt") },
  { id: "female", match: (v) => v.gender === "Femenina" },
  { id: "male", match: (v) => v.gender === "Masculina" },
  { id: "deep", match: (v) => v.tone === "Grave" },
];

export function VoiceGrid({
  voices,
  selectedId,
  returnTo,
  lang,
  t,
}: {
  voices: Voice[];
  selectedId: string | null;
  returnTo: string | null;
  lang: UiLang;
  t: Copy["voices"];
}) {
  const [filter, setFilter] = useState("all");
  const [sampling, setSampling] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const labels: Record<string, string> = {
    all: t.filterAll,
    es: "Español",
    en: "English",
    pt: "Português",
    female: t.filterFemale,
    male: t.filterMale,
    deep: t.filterDeep,
  };

  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const shown = voices.filter(active.match);

  function playSample(voice: Voice) {
    audio.current?.pause();
    if (sampling === voice.id || !voice.sample_url) {
      setSampling(null);
      return;
    }
    const el = new Audio(voice.sample_url);
    el.onended = () => setSampling(null);
    audio.current = el;
    void el.play();
    setSampling(voice.id);
  }

  /** Con `volver` cada tarjeta devuelve a personalizar con la voz ya elegida. */
  function hrefFor(voice: Voice): string | null {
    if (!returnTo) return null;
    const sep = returnTo.includes("?") ? "&" : "?";
    return `${returnTo}${sep}voz=${voice.slug}`;
  }

  return (
    <>
      <div className="mb-8 flex flex-wrap gap-[10px]">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            data-active={filter === f.id}
            aria-pressed={filter === f.id}
            className="om-pill"
          >
            {labels[f.id]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(272px,1fr))] gap-[14px]">
        {shown.map((v) => {
          const href = hrefFor(v);
          const chosen = v.id === selectedId;

          const card = (
            <>
              <div className="mb-[18px] flex items-center gap-4">
                <span className="h-12 w-12 flex-none rounded-full bg-clay-pale" aria-hidden="true" />
                <div className="mr-auto min-w-0">
                  <div className="text-[19px]">{v.name}</div>
                  <div className="mt-0.5 text-[14px] text-muted-soft">
                    {localized(v, lang, "accent")}
                  </div>
                </div>
                <span
                  className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] ${
                    chosen ? "bg-clay text-white" : "border border-line text-transparent"
                  }`}
                >
                  ✓
                </span>
              </div>

              <p className="mb-[18px] min-h-[46px] text-[15px] leading-[1.55] text-muted">
                {localized(v, lang, "blurb")}
              </p>

              <div className="mb-5 flex flex-wrap gap-1.5">
                {[
                  voiceGender(lang, v.gender),
                  voiceTone(lang, v.tone),
                  v.languages.join(" · ").toUpperCase(),
                ].map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-line px-[11px] py-1 text-[13px] text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    playSample(v);
                  }}
                  disabled={!v.sample_url}
                  aria-label={fill(t.sampleAria, { name: v.name })}
                  className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full border border-line-strong text-[10px] text-ink-soft disabled:opacity-40"
                >
                  {sampling === v.id ? "❚❚" : "▶"}
                </button>
                <Wave
                  count={30}
                  height={20}
                  color="var(--color-clay-bar)"
                  animate={sampling === v.id}
                  className="flex-1"
                />
                <span className="flex-none text-[13px] text-faint">
                  {v.sample_url ? "0:12" : "—"}
                </span>
              </div>
            </>
          );

          const className = `om-card px-6 py-[26px] transition-colors ${
            chosen ? "border-clay" : ""
          } ${href ? "cursor-pointer hover:border-clay-tint" : ""}`;

          return href ? (
            <Link key={v.id} href={href} className={className}>
              {card}
            </Link>
          ) : (
            <div key={v.id} className={className}>
              {card}
            </div>
          );
        })}
      </div>

      {shown.length === 0 && (
        <p className="om-card px-6 py-8 text-[16px] text-muted">{t.emptyFilter}</p>
      )}
    </>
  );
}
