"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { savePreferences } from "./actions";
import { DURATIONS, LOCALES } from "@/lib/config";
import type { Copy } from "@/lib/i18n";
import type { UserPrefs, Voice } from "@/lib/types";

const TOGGLE_KEYS: (keyof UserPrefs)[] = [
  "daily_reminder",
  "voice_emails",
  "publish_by_default",
  "improve_service",
];

export function Preferences({
  locale,
  defaultVoiceId,
  defaultDuration,
  prefs,
  voices,
  t,
}: {
  locale: string;
  defaultVoiceId: string | null;
  defaultDuration: number;
  prefs: UserPrefs;
  voices: Voice[];
  t: Copy["profile"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [state, setState] = useState({ locale, defaultVoiceId, defaultDuration, prefs });

  function update(patch: Partial<typeof state>) {
    const next = { ...state, ...patch };
    setState(next);
    setSaved(false);
    startTransition(async () => {
      await savePreferences({
        locale: next.locale,
        defaultVoiceId: next.defaultVoiceId,
        defaultDuration: next.defaultDuration,
        prefs: next.prefs,
      });
      setSaved(true);
      // Elegir idioma acá también cambia el de la interfaz, y esa copia se arma
      // en el servidor: hay que volver a pedir el árbol.
      if (patch.locale) router.refresh();
    });
  }

  const voice = voices.find((v) => v.id === state.defaultVoiceId);

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-[14px]">
      <div className="om-card px-7 py-[30px]">
        <div className="om-label mb-6 flex items-center justify-between">
          <span>{t.preferences}</span>
          <span className="text-[12px] normal-case tracking-normal text-faint">
            {pending ? t.saving : saved ? t.saved : ""}
          </span>
        </div>

        <div className="flex flex-col gap-[22px]">
          <div>
            <div className="mb-[10px] text-[15px] text-muted">{t.appLanguage}</div>
            <div className="flex flex-wrap gap-2">
              {LOCALES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => update({ locale: l.code })}
                  data-active={state.locale === l.code}
                  className="om-pill"
                >
                  {l.full}
                </button>
              ))}
            </div>
            {state.locale === "pt" && (
              <p className="mt-2 text-[13px] leading-[1.5] text-faint">{t.portugueseNote}</p>
            )}
          </div>

          <div>
            <div className="mb-[10px] text-[15px] text-muted">{t.defaultVoice}</div>
            <div className="flex items-center gap-[14px] rounded-card border border-line px-4 py-[14px]">
              <span className="h-[34px] w-[34px] flex-none rounded-full bg-clay-pale" aria-hidden="true" />
              <span className="mr-auto text-[16px]">{voice?.name ?? t.noVoiceChosen}</span>
              <Link href="/voces" className="text-[14px] text-clay">
                {t.viewBank}
              </Link>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {voices.slice(0, 6).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => update({ defaultVoiceId: v.id })}
                  data-active={state.defaultVoiceId === v.id}
                  className="om-pill px-[13px] py-1.5 text-[14px]"
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-[10px] text-[15px] text-muted">{t.usualDuration}</div>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => update({ defaultDuration: d })}
                  data-active={state.defaultDuration === d}
                  className="om-pill"
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="om-card px-7 py-[30px]">
        <div className="om-label mb-6">{t.accountAndData}</div>

        <div className="flex flex-col">
          {TOGGLE_KEYS.map((key, i) => {
            const on = state.prefs[key];
            const toggle = t.toggles[key];
            return (
              <div
                key={key}
                className={`flex items-center py-4 ${i ? "border-t border-line-hair" : ""}`}
              >
                <div className="mr-auto pr-[18px]">
                  <div className="text-[16px]">{toggle.label}</div>
                  <div className="mt-[3px] text-[13px] leading-[1.5] text-faint">
                    {toggle.note}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={toggle.label}
                  onClick={() => update({ prefs: { ...state.prefs, [key]: !on } })}
                  className={`flex h-[26px] w-[46px] flex-none cursor-pointer rounded-full border-none p-[3px] transition-colors ${
                    on ? "justify-end bg-clay" : "justify-start bg-line-pill"
                  }`}
                >
                  <span className="block h-5 w-5 rounded-full bg-paper" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="my-6 h-px bg-line-hair" />

        <div className="flex flex-col items-start gap-[14px]">
          <Link href="/terminos" className="text-[15px] text-ink-soft hover:text-clay">
            {t.termsLink}
          </Link>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="cursor-pointer text-[15px] text-ink-soft hover:text-clay">
              {t.signOut}
            </button>
          </form>
          <DeleteAccount t={t} />
        </div>
      </div>
    </div>
  );
}

function DeleteAccount({ t }: { t: Copy["profile"] }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="cursor-pointer text-[15px] text-danger"
      >
        {t.deleteAccount}
      </button>
    );
  }

  return (
    <div className="w-full rounded-card border border-danger/40 px-4 py-4">
      <p className="mb-3 text-[15px] leading-[1.55] text-ink-soft">{t.deleteWarning}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const { deleteAccount } = await import("./actions");
              await deleteAccount();
            })
          }
          className="om-btn om-btn-sm border-danger bg-danger text-white"
        >
          {pending ? t.deleting : t.deleteConfirm}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="om-btn om-btn-ghost om-btn-sm"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}
