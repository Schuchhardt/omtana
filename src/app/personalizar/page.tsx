import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Customizer } from "./Customizer";
import { SiteFooter } from "@/components/SiteFooter";
import { currentUser } from "@/lib/auth";
import {
  listBreathingExercises,
  listBreathingOptions,
  listVoices,
  remainingFree,
} from "@/lib/queries";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: copy(await getLang()).meta.titles.customize };
}

export default async function PersonalizarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/acceso");

  const [params, lang] = await Promise.all([searchParams, getLang()]);
  const t = copy(lang);
  const intention = params.intencion?.trim() || t.customize.defaultIntention;

  const [voices, exercises] = await Promise.all([listVoices(), listBreathingExercises()]);

  // Prioridad: la voz que viene en la URL, la preferida del perfil, la primera del banco.
  const fromUrl = params.voz ? voices.find((v) => v.slug === params.voz || v.id === params.voz) : null;
  const selectedVoiceId =
    fromUrl?.id ??
    (user.default_voice_id && voices.some((v) => v.id === user.default_voice_id)
      ? user.default_voice_id
      : (voices[0]?.id ?? ""));

  // La respiración se ofrece por voz: el audio está grabado con una voz concreta.
  const breathingOptions = await listBreathingOptions(selectedVoiceId);

  return (
    <main>
      <Suspense fallback={<div className="om-shell py-24 text-muted">{t.common.loading}</div>}>
        <Customizer
          intention={intention}
          intentionSlug={params.i ?? null}
          voices={voices}
          exercises={exercises}
          breathingOptions={breathingOptions}
          selectedVoiceId={selectedVoiceId}
          plan={user.plan}
          freeLeft={remainingFree(user)}
          credits={user.credits}
          publishByDefault={user.prefs.publish_by_default}
          lang={lang}
          t={t.customize}
        />
      </Suspense>
      <SiteFooter />
    </main>
  );
}
