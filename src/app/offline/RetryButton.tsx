"use client";

/** Recarga en vez de navegar: la página está en cache y navegar no reintenta la red. */
export function RetryButton({ label }: { label: string }) {
  return (
    <button type="button" className="om-btn om-btn-solid" onClick={() => window.location.reload()}>
      {label}
    </button>
  );
}
