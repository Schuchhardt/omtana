/**
 * Onda estática y determinista. Misma curva en servidor y cliente, así que no
 * hay salto de hidratación. La usa el hero, las muestras de voz y el frame de
 * video; el reproductor usa <LiveWave> sobre el audio real.
 */
export function barHeights(count: number, maxHeight: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const w =
      Math.sin(i * 0.37) * 0.5 + Math.sin(i * 0.11) * 0.35 + Math.sin(i * 1.7) * 0.15;
    return Math.max(0.12, Math.abs(w)) * maxHeight;
  });
}

export function Wave({
  count,
  height,
  color = "var(--color-clay)",
  animate = false,
  className = "",
}: {
  count: number;
  height: number;
  color?: string;
  animate?: boolean;
  className?: string;
}) {
  const heights = barHeights(count, height);
  return (
    <div
      className={`flex items-center gap-[3px] ${className}`}
      style={{ height }}
      aria-hidden="true"
    >
      {heights.map((h, i) => (
        <div
          key={i}
          className="min-w-[2px] max-w-[4px] flex-1 rounded-[2px]"
          style={{
            height: `${h.toFixed(1)}px`,
            background: color,
            animation: animate
              ? `omBar ${(1.6 + (i % 7) * 0.22).toFixed(2)}s ease-in-out ${((i % 11) * 0.13).toFixed(2)}s infinite`
              : undefined,
          }}
        />
      ))}
    </div>
  );
}
