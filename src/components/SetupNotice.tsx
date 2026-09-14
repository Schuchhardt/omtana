import { isConfigured } from "@/lib/supabase";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";

/** Aviso visible solo mientras falta conectar Supabase. */
export async function SetupNotice() {
  if (isConfigured()) return null;

  const t = copy(await getLang()).setupNotice;

  return (
    <div className="border-b border-line bg-clay-mist">
      <div className="om-shell flex flex-wrap items-center gap-3 py-3 text-[14px] text-ink-soft">
        <span className="h-[7px] w-[7px] flex-none rounded-full bg-clay" aria-hidden="true" />
        <span className="mr-auto">
          {t.before}
          <code className="font-mono text-clay">.env.example</code>
          {t.between}
          <code className="font-mono text-clay">.env.local</code>
          {t.afterFile}
          <code className="font-mono text-clay">npm run setup</code>
          {t.after}
        </span>
        <span className="text-faint">{t.note}</span>
      </div>
    </div>
  );
}
