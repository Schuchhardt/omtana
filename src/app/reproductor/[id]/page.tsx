import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  Player,
  type PlayerBreathing,
  type PlayerSection,
  type PlayerTrack,
} from "./Player";
import { currentUser } from "@/lib/auth";
import { getPlayable, listBreathingRenders, listMusic } from "@/lib/queries";
import { signedUrl, signedUrls } from "@/lib/storage";
import { getLang } from "@/lib/lang";
import { copy, localized, sectionLabel } from "@/lib/i18n";
import { breathingSlotSeconds } from "@/lib/breathing";

/** Desde esta versión la respiración va aparte; antes venía dentro del audio. */
const BREATHING_APART_FROM = 2;

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

  /*
   * La música de fondo se mezcla en el navegador, así que el reproductor recibe
   * el catálogo entero ya firmado y la persona cambia de pista sin volver al
   * servidor. Las pistas que no se pudieron firmar se caen de la lista en vez
   * de aparecer como un botón que no suena.
   */
  const [found, lang, tracks] = await Promise.all([
    getPlayable(id, user?.id ?? null),
    getLang(),
    listMusic(),
  ]);
  if (!found) notFound();

  const { meditation, segments, cues, voice } = found;

  /*
   * La respiración también es una capa aparte, y por eso se puede cambiar o
   * apagar acá. Solo se ofrece sobre sesiones generadas después de que salió
   * del guion: en las anteriores el audio ya la trae adentro y sonarían dos.
   */
  const renders =
    meditation.plan_version >= BREATHING_APART_FROM
      ? await listBreathingRenders(
          meditation.voice_id,
          meditation.locale,
          meditation.breathing_slot_seconds ||
            breathingSlotSeconds(Math.round(meditation.duration_seconds / 60)),
        )
      : [];

  const [audioUrl, trackUrls, breathingUrls] = await Promise.all([
    meditation.status === "ready" ? signedUrl(meditation.audio_path) : null,
    signedUrls(tracks.map((track) => track.audio_path)),
    signedUrls(renders.map((render) => render.audio_path)),
  ]);

  const playableTracks: PlayerTrack[] = tracks.flatMap((track, i) =>
    trackUrls[i] ? [{ id: track.id, name: track.name, url: trackUrls[i]! }] : [],
  );

  const breathing: PlayerBreathing[] = renders.flatMap((render, i) => {
    const url = breathingUrls[i];
    if (!url || !render.exercise) return [];
    return [
      {
        id: render.exercise.id,
        name: localized(render.exercise, lang, "name"),
        summary: localized(render.exercise, lang, "summary"),
        seconds: render.seconds,
        cycles: render.cycles,
        url,
        steps: render.steps,
        // De todo lo que dice, la parte en prosa: la entrada y el cierre. El
        // conteo no es guion, es la grilla.
        script: render.timeline
          .filter((cue) => cue.kind === "lead" || cue.kind === "tail")
          .map((cue) => cue.text)
          .join(" "),
      },
    ];
  });

  /*
   * El guion viaja rotulado en el idioma de la interfaz: los nombres de los
   * tramos son un vocabulario cerrado que vive en el diccionario, y traducirlos
   * acá le ahorra al cliente tener que cargarlo entero.
   */
  const sections: PlayerSection[] = segments.map((segment) => ({
    position: segment.position,
    kind: segment.kind,
    label: sectionLabel(lang, segment.label),
    text: segment.script_text,
    at: segment.start_offset_seconds,
    seconds: segment.seconds,
  }));

  return (
    <main>
      <Player
        id={meditation.id}
        title={meditation.title}
        voiceName={voice?.name ?? "Omtana"}
        initialStatus={meditation.status}
        initialAudioUrl={audioUrl}
        durationSeconds={meditation.duration_seconds}
        sections={sections}
        cues={cues}
        tracks={playableTracks}
        breathing={breathing}
        breathingId={meditation.breathing_exercise_id}
        bakedMusic={!!meditation.music_track_id}
        owned={meditation.user_id === user?.id}
        t={copy(lang).player}
      />
    </main>
  );
}
