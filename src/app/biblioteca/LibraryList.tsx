"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDate, formatDuration, plays as playsLabel } from "@/lib/format";
import type { Meditation, Visibility } from "@/lib/types";

const FILTERS = ["Todas", "Publicadas", "Privadas"] as const;

export function LibraryList({
  meditations,
  voiceNames,
}: {
  meditations: Meditation[];
  voiceNames: Record<string, string>;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Todas");
  const [visibility, setVisibility] = useState<Record<string, Visibility>>(
    Object.fromEntries(meditations.map((m) => [m.id, m.visibility])),
  );
  const [busy, setBusy] = useState<string | null>(null);

  const shown = meditations.filter((m) => {
    const v = visibility[m.id];
    if (filter === "Publicadas") return v === "public";
    if (filter === "Privadas") return v === "private";
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
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            data-active={filter === f}
            aria-pressed={filter === f}
            className="om-pill"
          >
            {f}
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
              aria-label={`Escuchar ${m.title}`}
              className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full border border-line-strong text-[10px] hover:border-clay"
            >
              ▶
            </Link>

            <Link href={`/reproductor/${m.id}`} className="min-w-0 flex-1 text-ink hover:text-ink">
              <span className="block truncate text-[17px]">{m.title}</span>
              <span className="mt-[3px] block text-[14px] text-faint">
                {formatDuration(m.duration_seconds)} ·{" "}
                {m.voice_id ? `${voiceNames[m.voice_id] ?? "Omtana"} · ` : ""}
                {formatDate(m.created_at)}
                {m.status !== "ready" && ` · ${m.status === "failed" ? "falló" : "generando"}`}
              </span>
            </Link>

            <span className="flex-none text-[14px] text-faint">{playsLabel(m.plays)}</span>

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
              {visibility[m.id] === "public" ? "Pública" : "Privada"}
            </button>
          </div>
        ))}

        {shown.length === 0 && (
          <p className="px-[22px] py-8 text-[16px] text-muted">
            No hay nada con ese filtro.
          </p>
        )}
      </div>
    </>
  );
}
