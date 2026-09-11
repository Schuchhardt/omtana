import type { ReactNode } from "react";

/** El disco que respira. Aparece en el hero, en acceso y detrás del reproductor. */
export function BreathCircle({ children }: { children?: ReactNode }) {
  return (
    <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-full border border-line-soft bg-paper">
      <div
        className="absolute h-[74%] w-[74%] rounded-full animate-breathe"
        style={{
          background:
            "radial-gradient(circle, var(--color-clay-glow) 0%, var(--color-clay-mist) 55%, rgba(246,233,221,0) 72%)",
        }}
        aria-hidden="true"
      />
      <div className="relative flex w-[72%] items-center justify-center">{children}</div>
    </div>
  );
}
