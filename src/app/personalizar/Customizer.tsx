"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { planOutline, planTotals, planSession } from "@/lib/session-plan";
import { breathingSlotSeconds, type BreathingExercise } from "@/lib/breathing";
import { formatClock } from "@/lib/format";
import { DURATIONS, LOCALES, CREDIT_COST_PER_MEDITATION } from "@/lib/config";
import type { BreathingOption } from "@/lib/queries";
import {
  copy,
  fill,
  plural,
  sectionLabel,
  localized,
  voiceTone,
  type Copy,
  type UiLang,
} from "@/lib/i18n";
import type { Voice } from "@/lib/types";

interface Props {
  intention: string;
  intentionSlug: string | null;
  voices: Voice[];
  exercises: BreathingExercise[];
  /** Qué ejercicios existen grabados con la voz elegida. */
  breathingOptions: BreathingOption[];
  selectedVoiceId: string;
  plan: "free" | "pro";
  freeLeft: number;
  credits: number;
  publishByDefault: boolean;
  lang: UiLang;
  t: Copy["customize"];
}

export function Customizer({
  intention,
  intentionSlug,
  voices,
  exercises,
  breathingOptions,
  selectedVoiceId,
  plan,
  freeLeft,
  credits,
  publishByDefault,
  lang,
  t,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [context, setContext] = useState(params.get("contexto") ?? "");
  const [duration, setDuration] = useState(Number(params.get("duracion") ?? 15));
  const [locale, setLocale] = useState(params.get("idioma") ?? "es");
  const [breathingId, setBreathingId] = useState(
    params.get("respiracion") ?? exercises[0]?.id ?? "",
  );
  const [publish, setPublish] = useState(
    params.get("visibilidad") ? params.get("visibilidad") === "public" : publishByDefault,
  );

  const minutes = copy(lang).common.minutes;
  const voice = voices.find((v) => v.id === selectedVoiceId) ?? voices[0];

  /*
   * Solo se ofrece lo que existe grabado para esta voz, este idioma y este hueco:
   * el audio de la respiración se pregenera a mano, así que ofrecer un ejercicio
   * sin grabar sería prometer algo que después no suena.
   */
  const slot = breathingSlotSeconds(duration);
  const available = useMemo(
    () =>
      exercises.flatMap((exercise) => {
        const option = breathingOptions.find(
          (o) => o.exercise_id === exercise.id && o.locale === locale && o.slot_seconds === slot,
        );
        return option ? [{ exercise, seconds: option.seconds }] : [];
      }),
    [exercises, breathingOptions, locale, slot],
  );

  const breathing = available.find((b) => b.exercise.id === breathingId) ?? null;
  const breathingLabel = breathing
    ? localized(breathing.exercise, lang, "name")
    : null;

  const sections = useMemo(
    () =>
      planOutline(
        duration,
        breathing ? { label: breathingLabel!, seconds: breathing.seconds } : null,
      ),
    [duration, breathing, breathingLabel],
  );
  const totals = useMemo(
    () => planTotals(planSession(duration, breathing?.seconds ?? 0)),
    [duration, breathing],
  );

  /** Vuelve al banco de voces sin perder lo escrito. */
  const voicesHref = (() => {
    const draft = new URLSearchParams({
      intencion: intention,
      duracion: String(duration),
      idioma: locale,
      respiracion: breathingId,
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
      ? t.costPro
      : freeLeft > 0
        ? fill(t.costIncluded, { n: freeLeft })
        : plural(t.costCredit, CREDIT_COST_PER_MEDITATION);

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
          breathingExerciseId: breathing?.exercise.id ?? null,
          visibility: publish ? "public" : "private",
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? t.errorFallback);
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
          {t.back}
        </Link>
        <p className="om-eyebrow mb-[10px]">{t.eyebrow}</p>
        <h1 className="mb-11 text-[clamp(28px,4vw,40px)]">{intention}</h1>

        <Section label={t.sectionContext}>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={4}
            maxLength={600}
            placeholder={t.contextPlaceholder}
            className="om-field resize-y px-5 py-[18px] text-[17px] leading-[1.55]"
          />
          <p className="mt-2 text-[13px] text-faint">
            {t.contextNote}
          </p>
        </Section>

        <Section label={t.sectionDuration}>
          <Pills
            options={DURATIONS.map((d) => ({ id: String(d), label: `${d} ${minutes}` }))}
            value={String(duration)}
            onChange={(v) => setDuration(Number(v))}
          />
        </Section>

        <Section label={t.sectionLanguage}>
          <Pills
            options={LOCALES.map((l) => ({ id: l.code, label: l.meditationLabel }))}
            value={locale}
            onChange={setLocale}
          />
        </Section>

        <Section label={t.sectionVoice}>
          <div className="om-card flex flex-wrap items-center gap-[18px] border-line-field px-[22px] py-[18px]">
            <span className="h-11 w-11 flex-none rounded-full bg-clay-pale" aria-hidden="true" />
            <div className="mr-auto min-w-0">
              <div className="text-[18px]">{voice?.name ?? t.noVoice}</div>
              <div className="mt-0.5 text-[14px] text-muted-soft">
                {voice
                  ? `${localized(voice, lang, "accent")} · ${voiceTone(lang, voice.tone)}`
                  : t.loadVoiceBank}
              </div>
            </div>
            <Link href={voicesHref} className="om-btn om-btn-ghost om-btn-sm flex-none">
              {copy(lang).common.change}
            </Link>
          </div>
        </Section>

        <Section label={t.sectionBreathing}>
          {available.length === 0 ? (
            <p className="text-[15px] leading-[1.55] text-muted-soft">{t.noBreathingAvailable}</p>
          ) : (
            <>
              <Pills
                options={[
                  ...available.map((b) => ({
                    id: b.exercise.id,
                    label: `${localized(b.exercise, lang, "name")} · ${formatClock(b.seconds)}`,
                  })),
                  { id: "", label: t.noBreathing },
                ]}
                value={breathing?.exercise.id ?? ""}
                onChange={setBreathingId}
              />
              <p className="mt-[10px] text-[13px] leading-[1.5] text-faint">
                {breathing
                  ? localized(breathing.exercise, lang, "summary")
                  : t.noBreathingNote}
              </p>
            </>
          )}
        </Section>

        <Section label={t.sectionWhenDone} last>
          <Pills
            options={[
              { id: "private", label: t.optionPrivate },
              { id: "public", label: t.optionPublish },
            ]}
            value={publish ? "public" : "private"}
            onChange={(v) => setPublish(v === "public")}
          />
          <p className="mt-[10px] text-[13px] text-faint">
            {publish ? t.publishNote : t.privateNote}
          </p>
        </Section>
      </div>

      {/* Resumen */}
      <aside className="om-card sticky top-[88px] px-7 py-[30px]">
        <div className="om-label mb-[22px]">{t.summaryTitle}</div>

        <div className="mb-[26px] flex flex-col gap-[14px]">
          {sections.map((s) => (
            <div key={s.key} className="flex items-center gap-[14px]">
              <span
                className="h-2 w-2 flex-none rounded-full"
                style={{ background: dotColor(s.kind) }}
              />
              <div className="mr-auto min-w-0">
                <div className="text-[16px]">{sectionLabel(lang, s.label)}</div>
                <div className="text-[13px] text-faint">
                  {s.kind === "dynamic"
                    ? t.generatedForYou
                    : s.kind === "breathing"
                      ? t.breathingPregenerated
                      : t.pregenerated}
                </div>
              </div>
              <span className="flex-none text-[14px] tabular-nums text-muted">
                {formatClock(s.seconds)}
              </span>
            </div>
          ))}
        </div>

        <div className="mb-[22px] h-px bg-line-hair" />

        <Line label={t.linePersonalized} value={formatClock(totals.dynamicSeconds)} />
        <Line label={t.lineVoice} value={voice?.name ?? "—"} />
        <Line label={t.lineCost} value={costLabel} last />

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
          {pending ? t.starting : blocked ? t.noCredits : t.generate}
        </button>

        <p className="mt-3 text-center text-[13px] text-faint">
          {blocked ? (
            <Link href="/planes">{t.blockedLink}</Link>
          ) : (
            t.readyNote
          )}
        </p>
      </aside>
    </div>
  );
}

function dotColor(kind: "fixed" | "dynamic" | "breathing"): string {
  if (kind === "dynamic") return "var(--color-clay)";
  if (kind === "breathing") return "var(--color-clay-tint)";
  return "var(--color-clay-bar)";
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
