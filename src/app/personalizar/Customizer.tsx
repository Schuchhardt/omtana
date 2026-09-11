"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { planSession, planTotals } from "@/lib/session-plan";
import { DURATIONS, LOCALES, CREDIT_COST_PER_MEDITATION } from "@/lib/config";
import type { MusicTrack, Voice } from "@/lib/types";

interface Props {
  intention: string;
  intentionSlug: string | null;
  voices: Voice[];
  music: MusicTrack[];
  selectedVoiceId: string;
  plan: "free" | "pro";
  freeLeft: number;
  credits: number;
  publishByDefault: boolean;
}

export function Customizer({
  intention,
  intentionSlug,
  voices,
  music,
  selectedVoiceId,
  plan,
  freeLeft,
  credits,
  publishByDefault,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [context, setContext] = useState(params.get("contexto") ?? "");
  const [duration, setDuration] = useState(Number(params.get("duracion") ?? 15));
  const [locale, setLocale] = useState(params.get("idioma") ?? "es");
  const [musicId, setMusicId] = useState(params.get("musica") ?? music[0]?.id ?? "");
  const [publish, setPublish] = useState(
    params.get("visibilidad") ? params.get("visibilidad") === "public" : publishByDefault,
  );

  const voice = voices.find((v) => v.id === selectedVoiceId) ?? voices[0];
  const sections = useMemo(() => planSession(duration), [duration]);
  const totals = useMemo(() => planTotals(sections), [sections]);

  /** Vuelve al banco de voces sin perder lo escrito. */
  const voicesHref = (() => {
    const draft = new URLSearchParams({
      intencion: intention,
      duracion: String(duration),
      idioma: locale,
      musica: musicId,
      visibilidad: publish ? "public" : "private",
    });
    if (intentionSlug) draft.set("i", intentionSlug);
    if (context) draft.set("contexto", context);
    return `/voces?volver=${encodeURIComponent(`/personalizar?${draft}`)}`;
  })();

  const usesCredit = plan !== "pro" && freeLeft <= 0;
  const blocked = usesCredit && credits <= 0;
  const costLabel =
    plan === "pro"
      ? "Incluido en Pro"
      : freeLeft > 0
        ? `Incluida (te quedan ${freeLeft})`
        : `${CREDIT_COST_PER_MEDITATION} crédito`;

  function generate() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/meditations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intention,
          intentionSlug,
          context,
          durationMinutes: duration,
          locale,
          voiceId: voice?.id,
          musicTrackId: musicId || null,
          visibility: publish ? "public" : "private",
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "No pudimos empezar la generación.");
        return;
      }
      router.push(`/reproductor/${body.id}`);
    });
  }

  return (
    <div className="om-shell grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-12 pb-24 pt-14">
      {/* Columna de ajustes */}
      <div>
        <Link href="/home" className="mb-[22px] block text-[14px] text-muted-soft hover:text-ink">
          ← Volver al banco
        </Link>
        <p className="om-eyebrow mb-[10px]">Personalizar</p>
        <h1 className="mb-11 text-[clamp(28px,4vw,40px)]">{intention}</h1>

        <Section label="Tu contexto">
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={4}
            maxLength={600}
            placeholder="Cuéntanos lo específico de tu caso."
            className="om-field resize-y px-5 py-[18px] text-[17px] leading-[1.55]"
          />
          <p className="mt-2 text-[13px] text-faint">
            Mientras más concreto, más se nota en los tramos personalizados.
          </p>
        </Section>

        <Section label="Duración">
          <Pills
            options={DURATIONS.map((d) => ({ id: String(d), label: `${d} min` }))}
            value={String(duration)}
            onChange={(v) => setDuration(Number(v))}
          />
        </Section>

        <Section label="Idioma de la meditación">
          <Pills
            options={LOCALES.map((l) => ({ id: l.code, label: l.meditationLabel }))}
            value={locale}
            onChange={setLocale}
          />
        </Section>

        <Section label="Voz">
          <div className="om-card flex flex-wrap items-center gap-[18px] border-line-field px-[22px] py-[18px]">
            <span className="h-11 w-11 flex-none rounded-full bg-clay-pale" aria-hidden="true" />
            <div className="mr-auto min-w-0">
              <div className="text-[18px]">{voice?.name ?? "Sin voz"}</div>
              <div className="mt-0.5 text-[14px] text-muted-soft">
                {voice ? `${voice.accent} · ${voice.tone}` : "Carga el banco de voces"}
              </div>
            </div>
            <Link href={voicesHref} className="om-btn om-btn-ghost om-btn-sm flex-none">
              Cambiar
            </Link>
          </div>
        </Section>

        <Section label="Música de fondo">
          <Pills
            options={[
              ...music.map((m) => ({ id: m.id, label: m.name })),
              { id: "", label: "Sin música" },
            ]}
            value={musicId}
            onChange={setMusicId}
          />
        </Section>

        <Section label="Al terminar" last>
          <Pills
            options={[
              { id: "private", label: "Privada" },
              { id: "public", label: "Publicar" },
            ]}
            value={publish ? "public" : "private"}
            onChange={(v) => setPublish(v === "public")}
          />
          <p className="mt-[10px] text-[13px] text-faint">
            {publish
              ? "Queda disponible para la comunidad con tu nombre. Puedes volver a dejarla privada cuando quieras."
              : "Solo para ti. Nadie más la ve en el catálogo."}
          </p>
        </Section>
      </div>

      {/* Resumen */}
      <aside className="om-card sticky top-[88px] px-7 py-[30px]">
        <div className="om-label mb-[22px]">Tu sesión</div>

        <div className="mb-[26px] flex flex-col gap-[14px]">
          {sections.map((s) => (
            <div key={s.position} className="flex items-center gap-[14px]">
              <span
                className="h-2 w-2 flex-none rounded-full"
                style={{
                  background:
                    s.kind === "dynamic" ? "var(--color-clay)" : "var(--color-clay-bar)",
                }}
              />
              <div className="mr-auto min-w-0">
                <div className="text-[16px]">{s.label}</div>
                <div className="text-[13px] text-faint">
                  {s.kind === "dynamic" ? "Generado para ti" : "Pregenerado"}
                </div>
              </div>
              <span className="flex-none text-[14px] text-muted">{s.minutes} min</span>
            </div>
          ))}
        </div>

        <div className="mb-[22px] h-px bg-line-hair" />

        <Line label="Tramos personalizados" value={`${totals.dynamicMinutes} min`} />
        <Line label="Voz" value={voice?.name ?? "—"} />
        <Line label="Costo" value={costLabel} last />

        {error && (
          <p role="alert" className="mb-3 text-[14px] leading-[1.5] text-danger">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={generate}
          disabled={pending || blocked || !voice}
          className="om-btn om-btn-solid w-full py-[15px]"
        >
          {pending ? "Empezando…" : blocked ? "Sin créditos" : "Generar meditación"}
        </button>

        <p className="mt-3 text-center text-[13px] text-faint">
          {blocked ? (
            <Link href="/planes">Compra créditos o pasa a Pro para seguir generando.</Link>
          ) : (
            "Lista en menos de un minuto"
          )}
        </p>
      </aside>
    </div>
  );
}

function Section({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={last ? "" : "mb-10"}>
      <div className="om-label mb-[14px]">{label}</div>
      {children}
    </div>
  );
}

function Pills({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-[10px]">
      {options.map((o) => (
        <button
          key={o.id || "none"}
          type="button"
          onClick={() => onChange(o.id)}
          data-active={value === o.id}
          aria-pressed={value === o.id}
          className="om-pill"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Line({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className={`flex justify-between text-[15px] text-muted ${last ? "mb-6" : "mb-2"}`}
    >
      <span>{label}</span>
      <span className="text-ink-soft">{value}</span>
    </div>
  );
}
