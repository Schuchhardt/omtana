import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Player } from "./Player";
import { currentUser } from "@/lib/auth";
import { getPlayable } from "@/lib/queries";
import { signedUrl } from "@/lib/storage";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const user = await currentUser();
  const found = await getPlayable(id, user?.id ?? null);
  return { title: found?.meditation.title ?? copy(await getLang()).meta.titles.player };
}

export default async function ReproductorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser();
  const [found, lang] = await Promise.all([getPlayable(id, user?.id ?? null), getLang()]);
  if (!found) notFound();

  const { meditation, segments, cues, voice } = found;

  return (
    <main>
      <Player
        id={meditation.id}
        title={meditation.title}
        voiceName={voice?.name ?? "Omtana"}
        initialStatus={meditation.status}
        initialAudioUrl={
          meditation.status === "ready" ? await signedUrl(meditation.audio_path) : null
        }
        durationSeconds={meditation.duration_seconds}
        segments={segments}
        cues={cues}
        owned={meditation.user_id === user?.id}
        t={copy(lang).player}
      />
    </main>
  );
}
