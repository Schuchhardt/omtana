import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { LibraryList } from "./LibraryList";
import { SiteFooter } from "@/components/SiteFooter";
import { currentUser } from "@/lib/auth";
import { listUserMeditations, listVoices } from "@/lib/queries";

export const metadata: Metadata = { title: "Mi biblioteca" };

export default async function BibliotecaPage() {
  const user = await currentUser();
  if (!user) redirect("/acceso");

  const [meditations, voices] = await Promise.all([
    listUserMeditations(user.id),
    listVoices(),
  ]);

  const voiceNames = Object.fromEntries(voices.map((v) => [v.id, v.name]));
  const count = meditations.length;

  return (
    <main>
      <div className="om-shell pb-24 pt-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="om-eyebrow mb-[10px]">Tu biblioteca</p>
            <h1 className="text-[clamp(28px,4vw,40px)]">
              {count === 0
                ? "Todavía no tienes meditaciones"
                : count === 1
                  ? "1 meditación tuya"
                  : `${count} meditaciones tuyas`}
            </h1>
          </div>
          <Link href="/home" className="om-btn om-btn-solid px-6 py-[13px] text-[15px]">
            Nueva meditación
          </Link>
        </div>

        {count === 0 ? (
          <p className="om-card px-6 py-8 text-[16px] leading-[1.6] text-muted">
            Lo que generes queda acá. Empieza declarando una intención en{" "}
            <Link href="/home">tu inicio</Link>.
          </p>
        ) : (
          <LibraryList meditations={meditations} voiceNames={voiceNames} />
        )}

        <p className="mt-7 max-w-[58ch] text-[14px] leading-[1.6] text-faint">
          Las meditaciones se escuchan dentro de Omtana; no hay descarga de audio. Si
          publicas una, queda disponible para la comunidad con tu nombre, y puedes volver a
          dejarla privada cuando quieras.
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
