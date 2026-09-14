import { LANG_NAMES, UI_LANGS, type UiLang } from "@/lib/i18n";
import { setLang } from "@/lib/lang-actions";

/**
 * Selector ES / EN.
 *
 * Es un formulario y no un botón con `document.cookie`: la copia se arma en el
 * servidor, así que el cambio de idioma es una escritura de cookie más un
 * repintado del layout. De paso funciona sin JavaScript.
 */
export function LangSwitch({
  lang,
  label,
  className = "",
}: {
  lang: UiLang;
  label: string;
  className?: string;
}) {
  return (
    <form
      action={setLang}
      aria-label={label}
      className={`flex flex-none items-center gap-[2px] ${className}`}
    >
      {UI_LANGS.map((code) => {
        const active = code === lang;
        return (
          <button
            key={code}
            type="submit"
            name="lang"
            value={code}
            aria-pressed={active}
            title={LANG_NAMES[code]}
            className={`cursor-pointer rounded-full px-[9px] py-1 text-[13px] tracking-[0.08em] transition-colors ${
              active ? "text-ink" : "text-faint-soft hover:text-ink"
            }`}
          >
            {code.toUpperCase()}
          </button>
        );
      })}
    </form>
  );
}
