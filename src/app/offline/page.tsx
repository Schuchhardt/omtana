import Image from "next/image";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";
import { RetryButton } from "./RetryButton";

/**
 * Lo que se ve cuando una navegación no encuentra red.
 *
 * El service worker la guarda al instalarse y la devuelve cuando `fetch` falla
 * (ver `src/app/sw.js/route.ts`). Se sirve tal cual quedó guardada, así que no
 * lleva nada que dependa de la sesión: solo la marca y el aviso.
 */
export default async function OfflinePage() {
  const t = copy(await getLang()).offline;

  return (
    <main className="om-shell flex min-h-[70vh] max-w-[46ch] flex-col items-start justify-center gap-4 py-24">
      <Image
        src="/brand/omtana-symbol-black.svg"
        alt=""
        width={44}
        height={44}
        className="mb-2 opacity-70"
      />
      <p className="om-eyebrow">{t.eyebrow}</p>
      <h1 className="text-[30px]">{t.title}</h1>
      <p className="text-[16px] leading-[1.7] text-muted">{t.body}</p>
      <div className="mt-2">
        <RetryButton label={t.retry} />
      </div>
    </main>
  );
}
