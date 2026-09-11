import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { VoiceGrid } from "./VoiceGrid";
import { SiteFooter } from "@/components/SiteFooter";
import { currentUser } from "@/lib/auth";
import { listVoices } from "@/lib/queries";

export const metadata: Metadata = { title: "Banco de voces" };

export default async function VocesPage({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>;
}) {
  const [user, voices, { volver }] = await Promise.all([
    currentUser(),
    listVoices(),
    searchParams,
  ]);

  // Solo aceptamos rutas internas como destino de vuelta.
  const returnTo = volver?.startsWith("/") && !volver.startsWith("//") ? volver : null;

  return (
    <main>
      <div className="om-shell pb-24 pt-14">
        {returnTo && (
          <Link href={returnTo} className="mb-[22px] block text-[14px] text-muted-soft hover:text-ink">
            ← Volver a personalizar
          </Link>
        )}

        <p className="om-eyebrow mb-[10px]">Banco de voces</p>
        <h1 className="mb-3 text-[clamp(28px,4vw,40px)]">¿Quién quieres que te hable?</h1>
        <p className="mb-10 max-w-[52ch] text-[17px] leading-[1.6] text-muted">
          Cada voz conduce la sesión como un personaje consistente. Escucha la muestra
          antes de elegir.
        </p>

        {voices.length === 0 ? (
          <p className="om-card px-6 py-8 text-[16px] leading-[1.6] text-muted">
            El banco de voces está vacío. Corre{" "}
            <code className="font-mono text-[14px] text-clay">npm run seed</code> y después{" "}
            <code className="font-mono text-[14px] text-clay">npm run voices:link</code>.
          </p>
        ) : (
          <Suspense fallback={null}>
            <VoiceGrid voices={voices} selectedId={user?.default_voice_id ?? null} returnTo={returnTo} />
          </Suspense>
        )}
      </div>

      <SiteFooter />
    </main>
  );
}
