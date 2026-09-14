"use client";

import { useEffect, useRef, useState } from "react";
import type { BreathingStep, StepKind } from "@/lib/breathing";
import type { Copy } from "@/lib/i18n";

const SIZE = 240;
/** Tamaño del disco con los pulmones vacíos y llenos, como fracción del círculo. */
const EMPTY = 0.42;
const FULL = 1;

/**
 * El círculo que respira con el audio.
 *
 * No tiene reloj propio: cada cuadro lee `currentTime` de la pista y busca en
 * qué fase cae. Por eso no puede desincronizarse — si la pestaña se va a
 * segundo plano y los cuadros se congelan, al volver el círculo aparece donde
 * corresponde en vez de arrastrar el desfase, que es exactamente lo que hacía
 * el conteo cuando venía leído dentro del guion.
 */
export function BreathingGuide({
  audio,
  steps,
  playing,
  title,
  t,
}: {
  audio: React.RefObject<HTMLAudioElement | null>;
  steps: BreathingStep[];
  playing: boolean;
  title: string;
  t: Copy["player"];
}) {
  const disc = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState<{ kind: StepKind; count: number | null }>({
    kind: "lead",
    count: null,
  });

  useEffect(() => {
    const paint = (level: number) => {
      if (disc.current) {
        disc.current.style.transform = `scale(${EMPTY + (FULL - EMPTY) * level})`;
      }
    };

    if (!playing) {
      paint(0);
      return;
    }

    let frame = 0;
    let shown = "";

    const draw = () => {
      frame = requestAnimationFrame(draw);

      const time = audio.current?.currentTime ?? 0;
      const step = stepAt(steps, time);
      if (!step) return;

      const progress = step.seconds > 0 ? (time - step.at) / step.seconds : 1;
      paint(level(step, Math.max(0, Math.min(1, progress))));

      // El número baja por segundos enteros, así que solo se re-renderiza doce
      // veces por ciclo y no sesenta por segundo.
      const count = counted(step) ? Math.max(1, Math.ceil(step.seconds - (time - step.at))) : null;
      const key = `${step.kind}-${count}`;
      if (key !== shown) {
        shown = key;
        setDisplay({ kind: step.kind, count });
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing, steps, audio]);

  return (
    <div
      className="relative mb-5 flex items-center justify-center"
      style={{ width: SIZE, height: SIZE }}
    >
      <div
        className="absolute inset-0 rounded-full border border-line-soft"
        aria-hidden="true"
      />
      <div
        ref={disc}
        className="absolute inset-0 rounded-full will-change-transform"
        style={{
          background:
            "radial-gradient(circle, var(--color-clay-glow) 0%, var(--color-clay-mist) 62%, rgba(246,233,221,0) 78%)",
          transform: `scale(${EMPTY})`,
        }}
        aria-hidden="true"
      />

      <div className="relative text-center" aria-live="polite">
        <div className="text-[19px] font-light tracking-[0.04em] text-ink-soft">
          {playing ? phaseLabel(t, display.kind) : title}
        </div>
        {display.count !== null && playing && (
          <div className="mt-1 text-[34px] font-light tabular-nums text-muted">
            {display.count}
          </div>
        )}
      </div>
    </div>
  );
}

/** En qué fase cae un instante. Los pasos vienen ordenados y sin huecos. */
function stepAt(steps: BreathingStep[], time: number): BreathingStep | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (time >= steps[i].at) return steps[i];
  }
  return steps[0] ?? null;
}

function level(step: BreathingStep, progress: number): number {
  if (step.from === step.to) return step.to;
  // Coseno y no lineal: el aire entra y sale sin tirones en los extremos, que es
  // como respira un cuerpo y no como se mueve una barra de progreso.
  const eased = 0.5 - 0.5 * Math.cos(Math.PI * progress);
  return step.from + (step.to - step.from) * eased;
}

function counted(step: BreathingStep): boolean {
  return step.kind !== "lead" && step.kind !== "tail";
}

function phaseLabel(t: Copy["player"], kind: StepKind): string {
  if (kind === "inhale") return t.phaseInhale;
  if (kind === "hold") return t.phaseHold;
  if (kind === "exhale") return t.phaseExhale;
  // El respiro entre ciclos es una espera con los pulmones como quedaron.
  if (kind === "empty" || kind === "gap") return t.phaseEmpty;
  if (kind === "tail") return t.phaseSettle;
  return t.phaseReady;
}
