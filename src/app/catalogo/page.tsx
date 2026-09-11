import Link from "next/link";
import type { Metadata } from "next";
import { MeditationRow } from "@/components/MeditationRow";
import { SiteFooter } from "@/components/SiteFooter";
import { listCatalog, listVoices } from "@/lib/queries";
import { formatDuration, plays as playsLabel } from "@/lib/format";

export const metadata: Metadata = { title: "Catálogo público" };
export const revalidate = 300;

export default async function CatalogoPage() {
  const [catalog, voices] = await Promise.all([listCatalog(48), listVoices()]);
  const voiceNames = Object.fromEntries(voices.map((v) => [v.id, v.name]));

  return (
    <main>
      <div className="om-shell pb-24 pt-14">
        <p className="om-eyebrow mb-[10px]">Catálogo</p>
        <h1 className="mb-3 text-[clamp(28px,4vw,40px)]">Listas para escuchar, sin generar</h1>
        <p className="mb-10 max-w-[52ch] text-[17px] leading-[1.6] text-muted">
          Lo que produce el equipo más lo que la comunidad decidió publicar. Gratis y sin
          cuenta.
        </p>

        {catalog.length === 0 ? (
          <p className="om-card px-6 py-8 text-[16px] leading-[1.6] text-muted">
            El catálogo todavía está vacío. Corre{" "}
            <code className="font-mono text-[14px] text-clay">npm run generate -- --curated</code>{" "}
            para pregenerar el banco inicial.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-[14px]">
            {catalog.map((m) => (
              <MeditationRow
                key={m.id}
                meditation={m}
                meta={`${formatDuration(m.duration_seconds)} · ${
                  m.voice_id ? `${voiceNames[m.voice_id] ?? "Omtana"} · ` : ""
                }${playsLabel(m.plays)}`}
              />
            ))}
          </div>
        )}

        <p className="mt-10 text-[15px] text-muted">
          ¿Quieres una alrededor de tu caso? <Link href="/acceso?modo=crear">Crea una cuenta</Link>.
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
