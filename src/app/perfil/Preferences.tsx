"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { savePreferences } from "./actions";
import { DURATIONS, LOCALES } from "@/lib/config";
import type { UserPrefs, Voice } from "@/lib/types";

const TOGGLES: { key: keyof UserPrefs; label: string; note: string }[] = [
  {
    key: "daily_reminder",
    label: "Recordatorio diario",
    note: "Un aviso a las 21:00 para tu sesión de la noche.",
  },
  {
    key: "voice_emails",
    label: "Correos sobre voces nuevas",
    note: "Cuando se suma un actor al banco.",
  },
  {
    key: "publish_by_default",
    label: "Publicar por defecto",
    note: "Todo lo que generes queda público salvo que lo cambies.",
  },
  {
    key: "improve_service",
    label: "Usar mis sesiones para mejorar el servicio",
    note: "Datos agregados, sin el texto de tu contexto.",
  },
];

export function Preferences({
  locale,
  defaultVoiceId,
  defaultDuration,
  prefs,
  voices,
}: {
  locale: string;
  defaultVoiceId: string | null;
  defaultDuration: number;
  prefs: UserPrefs;
  voices: Voice[];
}) {
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
    });
  }

  const voice = voices.find((v) => v.id === state.defaultVoiceId);

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-[14px]">
      <div className="om-card px-7 py-[30px]">
        <div className="om-label mb-6 flex items-center justify-between">
          <span>Preferencias</span>
          <span className="text-[12px] normal-case tracking-normal text-faint">
            {pending ? "Guardando…" : saved ? "Guardado" : ""}
          </span>
        </div>

        <div className="flex flex-col gap-[22px]">
          <div>
            <div className="mb-[10px] text-[15px] text-muted">Idioma de la aplicación</div>
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
          </div>

          <div>
            <div className="mb-[10px] text-[15px] text-muted">Voz por defecto</div>
            <div className="flex items-center gap-[14px] rounded-card border border-line px-4 py-[14px]">
              <span className="h-[34px] w-[34px] flex-none rounded-full bg-clay-pale" aria-hidden="true" />
              <span className="mr-auto text-[16px]">{voice?.name ?? "Sin elegir"}</span>
              <Link href="/voces" className="text-[14px] text-clay">
                Ver banco
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
            <div className="mb-[10px] text-[15px] text-muted">Duración habitual</div>
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
        <div className="om-label mb-6">Cuenta y datos</div>

        <div className="flex flex-col">
          {TOGGLES.map((t, i) => {
            const on = state.prefs[t.key];
            return (
              <div
                key={t.key}
                className={`flex items-center py-4 ${i ? "border-t border-line-hair" : ""}`}
              >
                <div className="mr-auto pr-[18px]">
                  <div className="text-[16px]">{t.label}</div>
                  <div className="mt-[3px] text-[13px] leading-[1.5] text-faint">{t.note}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={t.label}
                  onClick={() => update({ prefs: { ...state.prefs, [t.key]: !on } })}
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
            Términos y privacidad
          </Link>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="cursor-pointer text-[15px] text-ink-soft hover:text-clay">
              Cerrar sesión
            </button>
          </form>
          <DeleteAccount />
        </div>
      </div>
    </div>
  );
}

function DeleteAccount() {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="cursor-pointer text-[15px] text-danger"
      >
        Eliminar cuenta y datos
      </button>
    );
  }

  return (
    <div className="w-full rounded-card border border-danger/40 px-4 py-4">
      <p className="mb-3 text-[15px] leading-[1.55] text-ink-soft">
        Se borra tu biblioteca y tus datos. Lo que publicaste se queda en el catálogo, sin
        tu nombre. No se puede deshacer.
      </p>
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
          {pending ? "Eliminando…" : "Sí, eliminar todo"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="om-btn om-btn-ghost om-btn-sm"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
