"use client";

import { useState } from "react";
import { CREDIT_PACKS } from "@/lib/config";
import type { Copy } from "@/lib/i18n";

export function Checkout({
  paymentsEnabled,
  t,
}: {
  paymentsEnabled: boolean;
  t: Copy["plansPage"];
}) {
  const [pack, setPack] = useState<string>(CREDIT_PACKS[1].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(kind: "credits" | "pro") {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, packId: pack }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) {
      setError(body.error ?? t.checkoutError);
      setBusy(false);
      return;
    }
    window.location.href = body.url;
  }

  return (
    <div className="om-card px-7 py-[30px]" id="creditos">
      <div className="om-label mb-5">{t.buyCredits}</div>

      <div className="mb-5 flex flex-col gap-[10px]">
        {CREDIT_PACKS.map((p) => {
          const labels = t.creditPacks[p.id];
          return (
          <button
            key={p.id}
            type="button"
            onClick={() => setPack(p.id)}
            aria-pressed={pack === p.id}
            className={`flex cursor-pointer items-center gap-[14px] rounded-card border px-[18px] py-4 text-left transition-colors ${
              pack === p.id ? "border-clay" : "border-line"
            }`}
          >
            <span className="mr-auto">
              <span className="block text-[17px]">{labels.qty}</span>
              <span className="mt-0.5 block text-[13px] text-faint">{labels.unit}</span>
            </span>
            <span className="text-[17px]">{p.price}</span>
          </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mb-3 text-[14px] leading-[1.5] text-danger">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => go("credits")}
        disabled={busy || !paymentsEnabled}
        className="om-btn om-btn-solid w-full py-[15px]"
      >
        {busy ? t.opening : paymentsEnabled ? t.payWithStripe : t.paymentsOff}
      </button>

      <p className="mt-3 text-center text-[13px] text-faint">
        {t.creditsNote}
      </p>

      <div className="my-6 h-px bg-line-hair" id="pro" />

      <button
        type="button"
        onClick={() => go("pro")}
        disabled={busy || !paymentsEnabled}
        className="om-btn om-btn-ghost w-full py-[15px]"
      >
        {t.goPro}
      </button>
      <p className="mt-3 text-center text-[13px] text-faint">
        {t.proNote}
      </p>
    </div>
  );
}
