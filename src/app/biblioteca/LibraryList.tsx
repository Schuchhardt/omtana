"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDate, formatDuration, plays as playsLabel } from "@/lib/format";
import { fill, type Copy, type UiLang } from "@/lib/i18n";
import type { Meditation, Visibility } from "@/lib/types";

type FilterId = "all" | "published" | "private";

export function LibraryList({
  meditations,
  voiceNames,
  lang,
  t,
}: {
  meditations: Meditation[];
  voiceNames: Record<string, string>;
  lang: UiLang;
  t: Copy["library"];
}) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [visibility, setVisibility] = useState<Record<string, Visibility>>(
    Object.fromEntries(meditations.map((m) => [m.id, m.visibility])),
  );
  const [busy, setBusy] = useState<string | null>(null);

  // El id del filtro es estable y el rótulo cambia con el idioma, así que el
  // filtro elegido sobrevive al cambio de idioma.
  const filters: { id: FilterId; label: string }[] = [
    { id: "all", label: t.filterAll },
    { id: "published", label: t.filterPublished },
    { id: "private", label: t.filterPrivate },
  ];

  const shown = meditations.filter((m) => {
    const v = visibility[m.id];
    if (filter === "published") return v === "public";
    if (filter === "private") return v === "private";
    return true;
  });

  async function toggle(id: string) {
    const next: Visibility = visibility[id] === "public" ? "private" : "public";
    setBusy(id);
    const res = await fetch(`/api/meditations/${id}/visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    });
    if (res.ok) setVisibility((v) => ({ ...v, [id]: next }));
    setBusy(null);
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-[10px]">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            data-active={filter === f.id}
            aria-pressed={filter === f.id}
            className="om-pill"
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="om-card overflow-hidden">
        {shown.map((m, i) => (
          <div
            key={m.id}
            className={`flex flex-wrap items-center gap-4 px-[22px] py-4 ${
              i ? "border-t border-line-hair" : ""
            }`}
          >
            <Link
              href={`/reproductor/${m.id}`}
              aria-label={fill(t.playAria, { title: m.title })}
              className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full border border-line-strong text-[10px] hover:border-clay"
            >
              ▶
            </Link>

            <Link href={`/reproductor/${m.id}`} className="min-w-0 flex-1 text-ink hover:text-ink">
              <span className="block truncate text-[17px]">{m.title}</span>
              <span className="mt-[3px] block text-[14px] text-faint">
                {formatDuration(m.duration_seconds, lang)} ·{" "}
                {m.voice_id ? `${voiceNames[m.voice_id] ?? "Omtana"} · ` : ""}
                {formatDate(m.created_at, lang)}
                {m.status !== "ready" &&
                  ` · ${m.status === "failed" ? t.statusFailed : t.statusGenerating}`}
              </span>
            </Link>

            <span className="flex-none text-[14px] text-faint">{playsLabel(m.plays, lang)}</span>

            <button
              type="button"
              onClick={() => toggle(m.id)}
              disabled={busy === m.id || m.status !== "ready"}
              className={`flex-none cursor-pointer rounded-full border px-[13px] py-[5px] text-[13px] transition-colors disabled:opacity-50 ${
                visibility[m.id] === "public"
                  ? "border-clay text-clay"
                  : "border-line text-muted-soft"
              }`}
            >
              {visibility[m.id] === "public" ? t.public : t.private}
            </button>
          </div>
        ))}

        {shown.length === 0 && (
          <p className="px-[22px] py-8 text-[16px] text-muted">{t.emptyFilter}</p>
        )}
      </div>
    </>
  );
}
