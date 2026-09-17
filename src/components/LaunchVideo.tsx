"use client";

import { useRef, useState } from "react";
import type { Copy } from "@/lib/i18n";

/**
 * El video de presentación del landing.
 *
 * Hasta que alguien lo pide esto es una portada y un botón: el `<video>` sale
 * con `preload="none"`, así que el megabyte del archivo solo viaja si hay un
 * click. Lo único que se descarga al cargar la página son los 20 kB del
 * `poster`, que es la única imagen de la sección.
 *
 * Y suena. La pieza tiene música y cae al silencio en el cierre, así que
 * reproducirla muda sería perder la mitad: por eso no hay autoplay, que además
 * obligaría a bajar el archivo a todo el mundo para que la mayoría no lo mire.
 *
 * El archivo es el mismo render que sube a redes, reencodeado para la web
 * (1080p, CRF 32, `faststart`). Ver `public/video/`.
 */
export function LaunchVideo({ t }: { t: Copy["video"] }) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  function play() {
    const el = video.current;
    if (!el) return;
    /* Volver a la portada al terminar deja el video en su último fotograma;
       si lo vuelven a pedir, empieza de nuevo. */
    if (el.ended) el.currentTime = 0;
    setStarted(true);
    /* Con gesto del usuario no debería fallar, pero una promesa rechazada sin
       capturar ensucia la consola de quien esté mirando otra cosa. */
    void el.play().catch(() => undefined);
  }

  return (
    <div className="relative aspect-video overflow-hidden rounded-card border border-line bg-night">
      <video
        ref={video}
        className="h-full w-full"
        src="/video/omtana.mp4"
        poster="/video/omtana-poster.webp"
        preload="none"
        playsInline
        controls={started}
        aria-label={t.title}
        onEnded={() => setStarted(false)}
      />

      {!started && (
        <button
          type="button"
          onClick={play}
          aria-label={t.playAria}
          className="group absolute inset-0 grid cursor-pointer place-items-center border-none bg-transparent p-0"
        >
          <span className="grid h-[76px] w-[76px] place-items-center rounded-full bg-sand/95 transition-transform duration-200 group-hover:scale-[1.06]">
            <svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true" className="ml-[3px]">
              <path d="M22 13 0 26V0z" fill="var(--color-ink)" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}
