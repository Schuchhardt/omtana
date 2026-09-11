import { isConfigured } from "@/lib/supabase";

/** Aviso visible solo mientras falta conectar Supabase. */
export function SetupNotice() {
  if (isConfigured()) return null;

  return (
    <div className="border-b border-line bg-clay-mist">
      <div className="om-shell flex flex-wrap items-center gap-3 py-3 text-[14px] text-ink-soft">
        <span className="h-[7px] w-[7px] flex-none rounded-full bg-clay" aria-hidden="true" />
        <span className="mr-auto">
          Falta conectar Supabase. Copia <code className="font-mono text-clay">.env.example</code>{" "}
          a <code className="font-mono text-clay">.env.local</code> y corre{" "}
          <code className="font-mono text-clay">npm run setup</code>.
        </span>
        <span className="text-faint">El diseño se puede recorrer igual.</span>
      </div>
    </div>
  );
}
