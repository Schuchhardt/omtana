"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Copy } from "@/lib/i18n";

export function IntentionInput({ t }: { t: Copy["intentionInput"] }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  function go(intention: string) {
    const text = intention.trim();
    if (!text) return;
    router.push(`/personalizar?intencion=${encodeURIComponent(text)}`);
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
        className="mb-[18px] flex flex-wrap items-center gap-[14px] rounded-full border border-line-field bg-paper px-5 py-[14px]"
      >
        <span className="h-[7px] w-[7px] flex-none rounded-full bg-clay" aria-hidden="true" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={160}
          aria-label={t.ariaLabel}
          placeholder={t.placeholder}
          className="min-w-[160px] flex-1 border-none bg-transparent text-[17px] text-ink outline-none"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="om-btn om-btn-solid flex-none px-[22px] py-[10px] text-[15px]"
        >
          {t.submit}
        </button>
      </form>

      <div className="mb-12 flex flex-wrap items-center gap-2">
        <span className="mr-1 py-1.5 text-[14px] text-faint">{t.suggestionsLabel}</span>
        {t.suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => go(s)}
            className="cursor-pointer rounded-full border border-line-field bg-transparent px-[14px] py-1.5 text-[14px] text-ink-soft transition-colors hover:border-clay-tint"
          >
            {s}
          </button>
        ))}
      </div>
    </>
  );
}
