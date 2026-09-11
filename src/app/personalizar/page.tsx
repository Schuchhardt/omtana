import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Customizer } from "./Customizer";
import { SiteFooter } from "@/components/SiteFooter";
import { currentUser } from "@/lib/auth";
import { listMusic, listVoices, remainingFree } from "@/lib/queries";

export const metadata: Metadata = { title: "Personalizar" };

export default async function PersonalizarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/acceso");

  const params = await searchParams;
  const intention = params.intencion?.trim() || "Una meditación para hoy";

  const [voices, music] = await Promise.all([listVoices(), listMusic()]);

  // Prioridad: la voz que viene en la URL, la preferida del perfil, la primera del banco.
  const fromUrl = params.voz ? voices.find((v) => v.slug === params.voz || v.id === params.voz) : null;
  const selectedVoiceId =
    fromUrl?.id ??
    (user.default_voice_id && voices.some((v) => v.id === user.default_voice_id)
      ? user.default_voice_id
      : (voices[0]?.id ?? ""));

  return (
    <main>
      <Suspense fallback={<div className="om-shell py-24 text-muted">Cargando…</div>}>
        <Customizer
          intention={intention}
          intentionSlug={params.i ?? null}
          voices={voices}
          music={music}
          selectedVoiceId={selectedVoiceId}
          plan={user.plan}
          freeLeft={remainingFree(user)}
          credits={user.credits}
          publishByDefault={user.prefs.publish_by_default}
        />
      </Suspense>
      <SiteFooter />
    </main>
  );
}
