"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BreathingGuide } from "./BreathingGuide";
import { LiveWave } from "@/components/LiveWave";
import { formatClock } from "@/lib/format";
import { fill, type Copy } from "@/lib/i18n";
import { useMix } from "@/lib/player-mix";
import type { BreathingStep } from "@/lib/breathing";
import type { Cue, SectionKind } from "@/lib/types";

/** Un tramo de la sesión con su texto, ya rotulado en el idioma de la interfaz. */
export interface PlayerSection {
  position: number;
  kind: SectionKind;
  label: string;
  text: string;
  at: number;
  seconds: number;
}

/** Una pista de fondo ya firmada, lista para sonar en el navegador. */
export interface PlayerTrack {
  id: string;
  name: string;
  url: string;
}

/** Un ejercicio de respiración grabado para esta voz, con su grilla de tiempo. */
export interface PlayerBreathing {
  id: string;
  name: string;
  summary: string;
  seconds: number;
  cycles: number;
  url: string;
  steps: BreathingStep[];
  /** Lo que dice de corrido: la entrada y el cierre, que es la parte hablada. */
  script: string;
}

interface Props {
  id: string;
  title: string;
  voiceName: string;
  initialStatus: "pending" | "generating" | "ready" | "failed";
  initialAudioUrl: string | null;
  durationSeconds: number;
  sections: PlayerSection[];
  cues: Cue[];
  tracks: PlayerTrack[];
  breathing: PlayerBreathing[];
  /** El ejercicio con el que se generó la sesión; es el que viene puesto. */
  breathingId: string | null;
  /** La sesión ya salió de la fábrica con música mezclada en el archivo. */
  bakedMusic: boolean;
  owned: boolean;
  t: Copy["player"];
}

/** Milisegundos de entrada y salida de la música: un corte seco rompe la sesión. */
const FADE_MS = 1200;

export function Player(props: Props) {
  const t = props.t;
  const audio = useRef<HTMLAudioElement>(null);
  const music = useRef<HTMLAudioElement>(null);
  const breath = useRef<HTMLAudioElement>(null);
  const reported = useRef(false);

  const [status, setStatus] = useState(props.initialStatus);
  const [audioUrl, setAudioUrl] = useState(props.initialAudioUrl);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(props.title);
  const [duration, setDuration] = useState(props.durationSeconds);

  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  /*
   * La respiración es una pista aparte que va antes de la meditación, no un
   * tramo del archivo. Por eso se puede cambiar o saltar acá mismo sin
   * regenerar nada: son dos audios, no uno.
   */
  const [exerciseId, setExerciseId] = useState<string | null>(props.breathingId);
  const [breathingDone, setBreathingDone] = useState(false);
  const [breathElapsed, setBreathElapsed] = useState(0);

  /*
   * La mezcla: qué pista de fondo suena y a qué volumen cada capa. Los
   * volúmenes y la pista son preferencias guardadas; que esté sonando o no es
   * de esta sesión, y empieza en silencio porque el navegador no deja sonar
   * nada antes de que la persona toque algo.
   */
  const [{ voiceVolume, musicVolume, trackId }, setMix] = useMix();
  const [musicOn, setMusicOn] = useState(false);
  const [panel, setPanel] = useState<"breathing" | "music" | "script" | null>(null);

  const track = props.tracks.find((x) => x.id === trackId) ?? null;
  const exercise = props.breathing.find((x) => x.id === exerciseId) ?? null;
  const stage: "breathing" | "meditation" =
    exercise && !breathingDone ? "breathing" : "meditation";

  /* Mientras se genera, preguntamos por el estado cada dos segundos. */
  useEffect(() => {
    if (status === "ready" || status === "failed") return;

    const timer = setInterval(async () => {
      const res = await fetch(`/api/meditations/${props.id}/status`, { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();

      setStep(body.step);
      if (body.status === "ready") {
        setAudioUrl(body.audioUrl);
        setDuration(body.durationSeconds);
        setTitle(body.title);
        setStatus("ready");
      } else if (body.status === "failed") {
        setError(body.error);
        setStatus("failed");
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [status, props.id]);

  /* Una escucha se registra al terminar, o al salir si ya llevaba un minuto. */
  const report = useCallback(
    (completed: boolean) => {
      const seconds = Math.round(audio.current?.currentTime ?? 0);
      if (reported.current || (!completed && seconds < 60)) return;
      reported.current = true;

      const body = JSON.stringify({ secondsListened: seconds, completed });
      navigator.sendBeacon?.(
        `/api/meditations/${props.id}/play`,
        new Blob([body], { type: "application/json" }),
      );
    },
    [props.id],
  );

  useEffect(() => {
    const onHide = () => report(false);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [report]);

  /* ─────────────────────────── la mezcla ─────────────────────────── */

  useEffect(() => {
    // La respiración es la misma voz: comparte su control de volumen.
    if (audio.current) audio.current.volume = voiceVolume;
    if (breath.current) breath.current.volume = voiceVolume;
  }, [voiceVolume, audioUrl, exercise]);

  const fade = useRef<ReturnType<typeof setInterval> | null>(null);
  /* El volumen al que apunta el fundido, sin reiniciar la música al moverlo. */
  const musicTarget = useRef(musicVolume);
  useEffect(() => {
    musicTarget.current = musicVolume;
  }, [musicVolume]);

  const stopFade = useCallback(() => {
    if (fade.current === null) return;
    clearInterval(fade.current);
    fade.current = null;
  }, []);

  /**
   * Lleva la música hasta `to` en FADE_MS y recién ahí llama a `then`.
   *
   * Con reloj y no con `requestAnimationFrame`: en una pestaña en segundo plano
   * los cuadros se congelan y el fundido quedaba a medias — la música muda, o
   * sonando para siempre porque nunca llegaba el `pause`. El temporizador ahí
   * se frena a un tic por segundo, así que el fundido termina igual.
   */
  const fadeMusic = useCallback(
    (to: number, then?: () => void) => {
      const el = music.current;
      if (!el) return;
      stopFade();

      const from = el.volume;
      const start = performance.now();

      fade.current = setInterval(() => {
        const k = Math.min(1, (performance.now() - start) / FADE_MS);
        el.volume = clamp(from + (to - from) * k);
        if (k < 1) return;
        stopFade();
        then?.();
      }, 40);
    },
    [stopFade],
  );

  /* El elemento de música sigue a la intención: `musicOn` y la pista elegida. */
  useEffect(() => {
    const el = music.current;
    if (!el) return;

    if (!musicOn || !track) {
      if (!el.paused) fadeMusic(0, () => el.pause());
      return;
    }

    // Cambiar de pista aborta el `play()` anterior: esa promesa llega rechazada
    // y sin esta bandera apagaría la música que la persona acaba de elegir.
    let stale = false;
    el.volume = 0;
    void el
      .play()
      .then(() => {
        if (!stale) fadeMusic(musicTarget.current);
      })
      // Autoplay bloqueado o pista caída: se apaga en vez de mentir con el botón.
      .catch(() => {
        if (!stale) setMusicOn(false);
      });

    return () => {
      stale = true;
    };
  }, [musicOn, track, fadeMusic]);

  /* Mover el control manda sobre cualquier fundido en curso. */
  useEffect(() => {
    const el = music.current;
    if (!el || el.paused) return;
    stopFade();
    el.volume = musicVolume;
  }, [musicVolume, stopFade]);

  useEffect(() => stopFade, [stopFade]);

  /* ─────────────────────────── el transporte ─────────────────────────── */

  /** Cambiar de ejercicio mientras suena: el nuevo arranca desde cero. */
  const resume = useRef(false);
  useEffect(() => {
    if (!resume.current) return;
    resume.current = false;
    void breath.current?.play().catch(() => undefined);
  }, [exerciseId]);

  const phase = phaseLabel(t, props.sections, elapsed, duration);
  const keyword = currentCue(props.cues, elapsed);

  /*
   * El reloj es de la sesión completa, no del archivo: la respiración y la
   * meditación son dos pistas, pero para quien escucha son una sola cosa.
   */
  const breathingSeconds = exercise?.seconds ?? 0;
  const sessionSeconds = breathingSeconds + duration;
  const sessionElapsed =
    stage === "breathing" ? breathElapsed : breathingSeconds + elapsed;
  const progress =
    sessionSeconds > 0 ? Math.min(100, (sessionElapsed / sessionSeconds) * 100) : 0;

  function toggle() {
    const el = stage === "breathing" ? breath.current : audio.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      if (track) setMusicOn(true);
    } else {
      el.pause();
      setMusicOn(false);
    }
  }

  function seek(delta: number) {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || duration, el.currentTime + delta));
  }

  /** La respiración termina — o alguien la salta — y la meditación sigue sola. */
  function startMeditation(play: boolean) {
    breath.current?.pause();
    setBreathingDone(true);
    if (play) void audio.current?.play().catch(() => undefined);
  }

  function chooseExercise(id: string | null) {
    resume.current = !!breath.current && !breath.current.paused;
    setExerciseId(id);

    // Si la meditación todavía no empezó, la respiración nueva vuelve al frente.
    if (id && (audio.current?.currentTime ?? 0) === 0) setBreathingDone(false);
    if (!id) setBreathingDone(true);
  }

  /**
   * Saltar a un tramo desde el guion.
   *
   * Si todavía está sonando la respiración, la da por hecha: quien busca un
   * tramo del texto quiere el texto, no volver a empezar por el patrón.
   */
  function goTo(at: number) {
    const el = audio.current;
    if (!el) return;
    if (stage === "breathing") startMeditation(playing);
    el.currentTime = at;
    setElapsed(at);
  }

  /** Tocar la pista que ya está elegida la pausa o la retoma. */
  function chooseTrack(id: string) {
    if (id === trackId) {
      setMusicOn(!musicOn);
      return;
    }
    setMix({ trackId: id });
    setMusicOn(true);
  }

  return (
    <div className="relative flex min-h-[calc(100svh-var(--om-header-h))] flex-col items-center justify-center overflow-hidden px-6 py-16">
      <div
        className="pointer-events-none absolute -inset-[20%] animate-breathe"
        style={{
          background:
            "radial-gradient(circle at 50% 48%, #F3DFCE 0%, #F7EADC 38%, rgba(246,241,233,0) 68%)",
        }}
        aria-hidden="true"
      />

      <div className="relative flex w-full max-w-[760px] flex-col items-center">
        <p className="mb-4 text-[13px] uppercase tracking-[0.2em] text-faint">
          {status !== "ready" ? t.generating : stage === "breathing" ? t.phaseBreathing : phase}
        </p>
        <h1 className="mb-[10px] text-center text-[clamp(28px,4.2vw,44px)] font-light">
          {title}
        </h1>
        <p className="mb-14 text-[16px] text-muted-soft">
          {props.voiceName} · {formatClock(sessionSeconds)}
        </p>

        {status === "failed" ? (
          <div className="om-card max-w-[46ch] px-7 py-8 text-center">
            <p className="mb-4 text-[17px] leading-[1.6] text-ink-soft">
              {error ?? t.failedFallback}
            </p>
            <p className="mb-6 text-[14px] text-faint">
              {t.refundNote}
            </p>
            <Link href="/personalizar" className="om-btn om-btn-solid">
              {t.retryCta}
            </Link>
          </div>
        ) : status !== "ready" ? (
          <div className="flex flex-col items-center">
            <LiveWave audio={audio} playing />
            <p className="mt-6 text-[17px] text-muted">{step ?? t.preparing}…</p>
            <p className="mt-2 text-[14px] text-faint">{t.readyNote}</p>
          </div>
        ) : (
          <>
            {stage === "breathing" && exercise ? (
              <BreathingGuide
                audio={breath}
                steps={exercise.steps}
                playing={playing}
                title={exercise.name}
                t={t}
              />
            ) : (
              <LiveWave audio={audio} playing={playing} />
            )}

            <div className="mb-9 flex min-h-[52px] items-center">
              {stage === "breathing" && exercise ? (
                <p className="text-[15px] text-faint">
                  {fill(t.breathingCycles, { n: exercise.cycles })}
                </p>
              ) : (
                keyword && (
                  <p
                    key={keyword}
                    className="animate-fade-up text-[22px] font-light tracking-[0.04em] text-muted"
                  >
                    {keyword}
                  </p>
                )
              )}
            </div>

            <div className="mb-9 flex w-full max-w-[520px] items-center gap-4">
              <span className="flex-none text-[14px] tabular-nums text-faint">
                {formatClock(sessionElapsed)}
              </span>
              <div className="h-0.5 flex-1 overflow-hidden rounded-[2px] bg-[#e2d6c4]">
                <div
                  className="h-full bg-clay transition-[width] duration-500 ease-linear"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="flex-none text-[14px] tabular-nums text-faint">
                {formatClock(sessionSeconds)}
              </span>
            </div>

            <div className="mb-6 flex items-center gap-[22px]">
              {stage === "meditation" && (
                <button
                  type="button"
                  onClick={() => seek(-15)}
                  aria-label={t.back15}
                  className="h-[52px] w-[52px] cursor-pointer rounded-full border border-line-pill bg-transparent text-[13px] text-ink-soft hover:border-clay-tint"
                >
                  −15
                </button>
              )}
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? t.pause : t.play}
                className="flex h-[76px] w-[76px] cursor-pointer items-center justify-center rounded-full border-none bg-ink text-[20px] text-sand"
              >
                {playing ? "❚❚" : "▶"}
              </button>
              {stage === "meditation" && (
                <button
                  type="button"
                  onClick={() => seek(15)}
                  aria-label={t.forward15}
                  className="h-[52px] w-[52px] cursor-pointer rounded-full border border-line-pill bg-transparent text-[13px] text-ink-soft hover:border-clay-tint"
                >
                  +15
                </button>
              )}
            </div>

            <div className="mb-10 flex min-h-[24px] items-center">
              {stage === "breathing" && (
                <button
                  type="button"
                  onClick={() => startMeditation(playing)}
                  className="cursor-pointer border-none bg-transparent text-[14px] text-muted-soft underline-offset-4 hover:text-ink hover:underline"
                >
                  {t.breathingSkip}
                </button>
              )}
            </div>

            <div className="mb-11 w-full max-w-[520px]">
              <div className="flex flex-wrap justify-center gap-[10px]">
                {props.breathing.length > 0 && (
                  <PanelToggle
                    label={exercise ? `${t.breathingTitle} · ${exercise.name}` : t.breathingTitle}
                    lit={stage === "breathing"}
                    open={panel === "breathing"}
                    onClick={() => setPanel((p) => (p === "breathing" ? null : "breathing"))}
                  />
                )}
                {props.tracks.length > 0 && (
                  <PanelToggle
                    label={track ? `${t.musicTitle} · ${track.name}` : t.musicTitle}
                    lit={musicOn}
                    open={panel === "music"}
                    onClick={() => setPanel((p) => (p === "music" ? null : "music"))}
                  />
                )}
                <PanelToggle
                  label={t.scriptTitle}
                  lit={panel === "script"}
                  open={panel === "script"}
                  onClick={() => setPanel((p) => (p === "script" ? null : "script"))}
                />
              </div>

              {panel === "breathing" && (
                <BreathingPanel
                  t={t}
                  options={props.breathing}
                  exercise={exercise}
                  onChoose={chooseExercise}
                />
              )}

              {panel === "script" && (
                <ScriptPanel
                  t={t}
                  sections={props.sections}
                  breathing={stage === "breathing" ? exercise : null}
                  elapsed={stage === "breathing" ? -1 : elapsed}
                  onSeek={goTo}
                />
              )}

              {panel === "music" && (
                <Mixer
                  t={t}
                  tracks={props.tracks}
                  track={track}
                  musicOn={musicOn}
                  bakedMusic={props.bakedMusic}
                  voiceVolume={voiceVolume}
                  musicVolume={musicVolume}
                  onChooseTrack={chooseTrack}
                  onClearTrack={() => {
                    setMusicOn(false);
                    setMix({ trackId: null });
                  }}
                  onToggleMusic={() => setMusicOn((on) => !on)}
                  onVoiceVolume={(v) => setMix({ voiceVolume: v })}
                  onMusicVolume={(v) => setMix({ musicVolume: v })}
                />
              )}
            </div>

            <div className="flex flex-wrap justify-center gap-[10px]">
              {props.owned && (
                <Link href="/biblioteca" className="om-btn om-btn-ghost om-btn-sm">
                  {t.viewInLibrary}
                </Link>
              )}
              <Link href="/voces" className="om-btn om-btn-ghost om-btn-sm">
                {t.changeVoice}
              </Link>
              <Link href="/personalizar" className="om-btn om-btn-ghost om-btn-sm">
                {t.generateAnother}
              </Link>
            </div>

            {/*
              La respiración: su propia pista, con la grilla que anima el
              círculo. Al terminar, la meditación sigue sola.
            */}
            {exercise && (
              <audio
                ref={breath}
                src={exercise.url}
                preload="auto"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(e) => setBreathElapsed(e.currentTarget.currentTime)}
                onEnded={() => startMeditation(true)}
              />
            )}

            {audioUrl && (
              <audio
                ref={audio}
                src={audioUrl}
                crossOrigin="anonymous"
                preload="auto"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                  if (Number.isFinite(e.currentTarget.duration)) {
                    setDuration(Math.round(e.currentTarget.duration));
                  }
                }}
                onEnded={() => {
                  setPlaying(false);
                  setMusicOn(false);
                  report(true);
                }}
              />
            )}

            {/*
              La música vive en su propio elemento, en loop y sin analizador:
              la onda sigue a la voz, que es lo que la persona está siguiendo.
            */}
            <audio ref={music} src={track?.url} loop preload="none" />
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── los paneles ─────────────────────────── */

function PanelToggle({
  label,
  lit,
  open,
  onClick,
}: {
  label: string;
  lit: boolean;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="om-btn om-btn-ghost om-btn-sm"
    >
      <span
        className="h-1.5 w-1.5 rounded-full transition-colors"
        style={{ background: lit ? "var(--color-clay)" : "var(--color-line-strong)" }}
        aria-hidden="true"
      />
      {label}
    </button>
  );
}

function BreathingPanel({
  t,
  options,
  exercise,
  onChoose,
}: {
  t: Copy["player"];
  options: PlayerBreathing[];
  exercise: PlayerBreathing | null;
  onChoose: (id: string | null) => void;
}) {
  return (
    <div className="om-card mt-4 px-6 py-6">
      <div className="mb-[14px] flex items-center gap-4">
        <div className="om-label">{t.breathingTitle}</div>
        <p className="text-[13px] text-faint">{t.breathingNote}</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-[8px]">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChoose(option.id)}
            data-active={exercise?.id === option.id}
            aria-pressed={exercise?.id === option.id}
            className="om-pill !px-[14px] !text-[14px]"
          >
            {option.name} · {formatClock(option.seconds)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChoose(null)}
          data-active={!exercise}
          aria-pressed={!exercise}
          className="om-pill !px-[14px] !text-[14px]"
        >
          {t.breathingNone}
        </button>
      </div>

      {exercise && (
        <p className="text-[13px] leading-[1.55] text-faint">{exercise.summary}</p>
      )}
    </div>
  );
}

/**
 * El guion de la sesión, tramo por tramo.
 *
 * El texto ya venía en la base — es lo que se sintetizó — y no mostrarlo era
 * esconder de qué está hecha la meditación. Cada tramo lleva su minuto y se
 * puede saltar ahí, que es lo que se quiere cuando se relee.
 */
function ScriptPanel({
  t,
  sections,
  breathing,
  elapsed,
  onSeek,
}: {
  t: Copy["player"];
  sections: PlayerSection[];
  breathing: PlayerBreathing | null;
  elapsed: number;
  onSeek: (at: number) => void;
}) {
  const active = [...sections].reverse().find((s) => elapsed >= s.at);

  return (
    <div className="om-card mt-4 max-h-[420px] overflow-y-auto px-6 py-6">
      <div className="mb-[14px] flex items-center gap-4">
        <div className="om-label">{t.scriptTitle}</div>
        <p className="text-[13px] text-faint">{t.scriptNote}</p>
      </div>

      {breathing && (
        <div className="mb-5">
          <div className="mb-1 flex items-baseline gap-3">
            <span className="text-[15px] text-ink-soft">{breathing.name}</span>
            <span className="text-[13px] tabular-nums text-faint">
              {formatClock(breathing.seconds)}
            </span>
          </div>
          <p className="text-[15px] leading-[1.6] text-muted">{breathing.script}</p>
        </div>
      )}

      {sections.map((section) => (
        <div key={section.position} className="mb-5 last:mb-0">
          <button
            type="button"
            onClick={() => onSeek(section.at)}
            className="mb-1 flex w-full cursor-pointer items-baseline gap-3 border-none bg-transparent p-0 text-left"
          >
            <span
              className="text-[15px]"
              style={{
                color:
                  active?.position === section.position
                    ? "var(--color-clay)"
                    : "var(--color-ink-soft)",
              }}
            >
              {section.label}
            </span>
            <span className="text-[13px] tabular-nums text-faint">
              {formatClock(section.at)}
            </span>
          </button>
          <p className="text-[15px] leading-[1.6] text-muted">
            {section.text || t.scriptEmpty}
          </p>
        </div>
      ))}
    </div>
  );
}

interface MixerProps {
  t: Copy["player"];
  tracks: PlayerTrack[];
  track: PlayerTrack | null;
  musicOn: boolean;
  bakedMusic: boolean;
  voiceVolume: number;
  musicVolume: number;
  onChooseTrack: (id: string) => void;
  onClearTrack: () => void;
  onToggleMusic: () => void;
  onVoiceVolume: (v: number) => void;
  onMusicVolume: (v: number) => void;
}

function Mixer(p: MixerProps) {
  const { t } = p;

  return (
    <div className="om-card mt-4 px-6 py-6">
      <div className="mb-[14px] flex items-center gap-4">
        <div className="om-label">{t.musicTitle}</div>
        <p className="mr-auto text-[13px] text-faint">{t.musicSubtitle}</p>
        <button
          type="button"
          onClick={p.onToggleMusic}
          disabled={!p.track}
          aria-label={p.musicOn ? t.musicPause : t.musicPlay}
          className="flex h-9 w-9 flex-none cursor-pointer items-center justify-center rounded-full border border-line-pill bg-transparent text-[12px] text-ink-soft hover:border-clay-tint disabled:cursor-not-allowed disabled:opacity-40"
        >
          {p.musicOn ? "❚❚" : "▶"}
        </button>
      </div>

      <div className="mb-6 flex max-h-[152px] flex-wrap gap-[8px] overflow-y-auto">
        {p.tracks.map((track) => (
          <button
            key={track.id}
            type="button"
            onClick={() => p.onChooseTrack(track.id)}
            data-active={p.track?.id === track.id}
            aria-pressed={p.track?.id === track.id}
            className="om-pill !px-[14px] !text-[14px]"
          >
            {track.name}
          </button>
        ))}
        <button
          type="button"
          onClick={p.onClearTrack}
          data-active={!p.track}
          aria-pressed={!p.track}
          className="om-pill !px-[14px] !text-[14px]"
        >
          {t.musicNone}
        </button>
      </div>

      <Volume label={t.volumeVoice} value={p.voiceVolume} onChange={p.onVoiceVolume} />
      <Volume
        label={t.volumeMusic}
        value={p.musicVolume}
        onChange={p.onMusicVolume}
        disabled={!p.track}
      />

      {p.bakedMusic && (
        <p className="mt-4 text-[13px] leading-[1.5] text-faint">{t.musicBakedNote}</p>
      )}
    </div>
  );
}

function Volume({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="mb-[14px] flex items-center gap-4 last:mb-0">
      <span className="w-[68px] flex-none text-[14px] text-muted">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="om-range flex-1 disabled:opacity-40"
      />
      <span className="w-[42px] flex-none text-right text-[13px] tabular-nums text-faint">
        {Math.round(value * 100)}%
      </span>
    </label>
  );
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function phaseLabel(
  t: Copy["player"],
  sections: PlayerSection[],
  elapsed: number,
  total: number,
): string {
  const active = [...sections].reverse().find((s) => elapsed >= s.at);

  if (!active) return t.phaseBody;
  if (elapsed > total - 90) return t.phaseClosing;
  return active.kind === "dynamic" ? t.phaseYourSegment : t.phaseBody;
}

function currentCue(cues: Cue[], elapsed: number): string | null {
  const active = [...cues].reverse().find((c) => elapsed >= c.at_seconds);
  // Cada palabra se queda ocho segundos y después la pantalla vuelve a estar limpia.
  if (!active || elapsed - active.at_seconds > 8) return null;
  return active.word;
}
