import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Player } from "./Player";
import { currentUser } from "@/lib/auth";
import { getPlayable } from "@/lib/queries";
import { signedUrl } from "@/lib/storage";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const user = await currentUser();
  const found = await getPlayable(id, user?.id ?? null);
  return { title: found?.meditation.title ?? "Reproductor" };
}

export default async function ReproductorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser();
  const found = await getPlayable(id, user?.id ?? null);
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
      />
    </main>
  );
}
