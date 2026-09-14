"use client";

import { useState } from "react";

export interface FaqItem {
  q: string;
  a: string;
}

export function Faq({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState(0);

  return (
    <div>
      {items.map((f, i) => (
        <div key={f.q} className={`border-b border-line ${i === 0 ? "border-t" : ""}`}>
          <button
            type="button"
            onClick={() => setOpen(open === i ? -1 : i)}
            aria-expanded={open === i}
            className="flex w-full cursor-pointer items-center gap-4 border-none bg-transparent py-5 text-left text-ink"
          >
            <span className="mr-auto text-[17px]">{f.q}</span>
            <span className="flex-none text-[18px] text-faint">{open === i ? "−" : "+"}</span>
          </button>
          {open === i && (
            <div className="max-w-[56ch] pb-[22px] pr-10 text-[16px] leading-[1.65] text-muted">
              {f.a}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
