"use client";

import { useEffect, useRef } from "react";
import { barHeights } from "./Wave";

const BARS = 72;
const MAX_HEIGHT = 84;

/**
 * La onda del reproductor. Cuando el navegador deja analizar el audio, las
 * barras siguen el espectro real; si no (CORS, autoplay bloqueado), cae a la
 * misma curva animada del resto del sitio. En ambos casos se ve igual de vivo.
 */
export function LiveWave({
  audio,
  playing,
}: {
  audio: React.RefObject<HTMLAudioElement | null>;
  playing: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const frame = useRef<number>(0);
  const fallback = useRef(false);

  // El grafo de audio se crea una sola vez: un MediaElementSource por elemento.
  useEffect(() => {
    const el = audio.current;
    if (!el || analyser.current || fallback.current) return;

    function connect() {
      try {
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const source = ctx.createMediaElementSource(el!);
        const node = ctx.createAnalyser();
        node.fftSize = 256;
        node.smoothingTimeConstant = 0.78;
        source.connect(node);
        node.connect(ctx.destination);
        analyser.current = node;
        if (ctx.state === "suspended") void ctx.resume();
      } catch {
        fallback.current = true;
      }
    }

    el.addEventListener("play", connect, { once: true });
    return () => el.removeEventListener("play", connect);
  }, [audio]);

  useEffect(() => {
    const root = container.current;
    if (!root) return;

    const bars = Array.from(root.children) as HTMLElement[];
    const resting = barHeights(BARS, MAX_HEIGHT);

    if (!playing) {
      cancelAnimationFrame(frame.current);
      bars.forEach((bar, i) => {
        bar.style.transform = `scaleY(${(resting[i] / MAX_HEIGHT) * 0.55})`;
      });
      return;
    }

    const data = new Uint8Array(128);

    function draw() {
      frame.current = requestAnimationFrame(draw);
      const node = analyser.current;

      if (!node) {
        // Sin analizador: onda sintética que respira con el tiempo.
        const t = performance.now() / 620;
        bars.forEach((bar, i) => {
          const wobble = 0.55 + Math.sin(t + i * 0.34) * 0.45;
          bar.style.transform = `scaleY(${Math.max(0.12, (resting[i] / MAX_HEIGHT) * wobble * 1.5)})`;
        });
        return;
      }

      node.getByteFrequencyData(data);
      bars.forEach((bar, i) => {
        // Las voces viven en la parte baja del espectro; comprimimos hacia ahí.
        const bin = Math.floor((i / BARS) ** 1.7 * 90) + 2;
        const value = data[bin] / 255;
        bar.style.transform = `scaleY(${Math.max(0.1, value * 1.25)})`;
      });
    }

    frame.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame.current);
  }, [playing]);

  return (
    <div
      ref={container}
      className="mb-5 flex w-full items-center justify-center gap-[3px]"
      style={{ height: MAX_HEIGHT }}
      aria-hidden="true"
    >
      {Array.from({ length: BARS }, (_, i) => (
        <div
          key={i}
          className="min-w-[2px] max-w-[4px] flex-1 rounded-[2px] transition-transform duration-100 ease-out"
          style={{
            height: MAX_HEIGHT,
            background: playing ? "var(--color-clay)" : "var(--color-line-strong)",
            transform: "scaleY(0.2)",
          }}
        />
      ))}
    </div>
  );
}
