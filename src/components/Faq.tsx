"use client";

import { useState } from "react";

const FAQS = [
  {
    q: "¿En qué se diferencia de una app con catálogo?",
    a: "En que no eliges lo que más se acerca a tu caso. Declaras qué quieres lograr y el guion se escribe alrededor de eso, con tu contexto adentro.",
  },
  {
    q: "¿Cuánto demora generar una meditación?",
    a: "Menos de un minuto. La mayor parte del audio ya está pregenerada; solo los tramos personalizados se crean en el momento y se intercalan.",
  },
  {
    q: "¿Puedo descargar el audio?",
    a: "No. Las meditaciones se escuchan dentro de Omtana. Lo que generas queda en tu biblioteca mientras tengas cuenta.",
  },
  {
    q: "¿Qué pasa con lo que escribo en mi contexto?",
    a: "Se usa para escribir tu meditación. No aparece en las sesiones que publicas ni se comparte con otros usuarios.",
  },
  {
    q: "¿En qué idiomas está?",
    a: "Español, inglés y portugués, con voces propias para cada uno. El idioma de la meditación se elige aparte del idioma de la interfaz.",
  },
];

export function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <div>
      {FAQS.map((f, i) => (
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
