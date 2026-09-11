"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveWave } from "@/components/LiveWave";
import { formatClock } from "@/lib/format";
import type { Cue, MeditationSegment } from "@/lib/types";

interface Props {
  id: string;
  title: string;
  voiceName: string;
  initialStatus: "pending" | "generating" | "ready" | "failed";
  initialAudioUrl: string | null;
  durationSeconds: number;
  segments: MeditationSegment[];
  cues: Cue[];
  owned: boolean;
}

export function Player(props: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const reported = useRef(false);

  const [status, setStatus] = useState(props.initialStatus);
  const [audioUrl, setAudioUrl] = useState(props.initialAudioUrl);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(props.title);
  const [duration, setDuration] = useState(props.durationSeconds);

  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

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

  const phase = phaseLabel(props.segments, elapsed, duration);
  const keyword = currentCue(props.cues, elapsed);
  const progress = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  function seek(delta: number) {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || duration, el.currentTime + delta));
  }

  return (
    <div className="relative flex min-h-[calc(100vh-62px)] flex-col items-center justify-center overflow-hidden px-6 py-16">
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
          {status === "ready" ? phase : "Generando"}
        </p>
        <h1 className="mb-[10px] text-center text-[clamp(28px,4.2vw,44px)] font-light">
          {title}
        </h1>
        <p className="mb-14 text-[16px] text-muted-soft">
          {props.voiceName} · {formatClock(duration)}
        </p>

        {status === "failed" ? (
          <div className="om-card max-w-[46ch] px-7 py-8 text-center">
            <p className="mb-4 text-[17px] leading-[1.6] text-ink-soft">
              {error ?? "La generación falló."}
            </p>
            <p className="mb-6 text-[14px] text-faint">
              Te devolvimos la personalización. Puedes volver a intentarlo.
            </p>
            <Link href="/personalizar" className="om-btn om-btn-solid">
              Ajustar y reintentar
            </Link>
          </div>
        ) : status !== "ready" ? (
          <div className="flex flex-col items-center">
            <LiveWave audio={audio} playing />
            <p className="mt-6 text-[17px] text-muted">{step ?? "Preparando la sesión"}…</p>
            <p className="mt-2 text-[14px] text-faint">Lista en menos de un minuto</p>
          </div>
        ) : (
          <>
            <LiveWave audio={audio} playing={playing} />

            <div className="mb-9 flex min-h-[52px] items-center">
              {keyword && (
                <p
                  key={keyword}
                  className="animate-fade-up text-[22px] font-light tracking-[0.04em] text-muted"
                >
                  {keyword}
                </p>
              )}
            </div>

            <div className="mb-9 flex w-full max-w-[520px] items-center gap-4">
              <span className="flex-none text-[14px] tabular-nums text-faint">
                {formatClock(elapsed)}
              </span>
              <div className="h-0.5 flex-1 overflow-hidden rounded-[2px] bg-[#e2d6c4]">
                <div
                  className="h-full bg-clay transition-[width] duration-500 ease-linear"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="flex-none text-[14px] tabular-nums text-faint">
                {formatClock(duration)}
              </span>
            </div>

            <div className="mb-11 flex items-center gap-[22px]">
              <button
                type="button"
                onClick={() => seek(-15)}
                aria-label="Retroceder 15 segundos"
                className="h-[52px] w-[52px] cursor-pointer rounded-full border border-line-pill bg-transparent text-[13px] text-ink-soft hover:border-clay-tint"
              >
                −15
              </button>
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? "Pausar" : "Reproducir"}
                className="flex h-[76px] w-[76px] cursor-pointer items-center justify-center rounded-full border-none bg-ink text-[20px] text-sand"
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <button
                type="button"
                onClick={() => seek(15)}
                aria-label="Avanzar 15 segundos"
                className="h-[52px] w-[52px] cursor-pointer rounded-full border border-line-pill bg-transparent text-[13px] text-ink-soft hover:border-clay-tint"
              >
                +15
              </button>
            </div>

            <div className="flex flex-wrap justify-center gap-[10px]">
              {props.owned && (
                <Link href="/biblioteca" className="om-btn om-btn-ghost om-btn-sm">
                  Ver en mi biblioteca
                </Link>
              )}
              <Link href="/voces" className="om-btn om-btn-ghost om-btn-sm">
                Cambiar de voz
              </Link>
              <Link href="/personalizar" className="om-btn om-btn-ghost om-btn-sm">
                Generar otra
              </Link>
            </div>

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
                  report(true);
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function phaseLabel(segments: MeditationSegment[], elapsed: number, total: number): string {
  const active = [...segments]
    .reverse()
    .find((s) => elapsed >= s.start_offset_seconds);

  if (!active) return "Respiración guiada";
  if (active.position === 0) return "Respiración guiada";
  if (elapsed > total - 90) return "Cierre";
  return active.kind === "dynamic" ? "Tu tramo" : "Cuerpo de la meditación";
}

function currentCue(cues: Cue[], elapsed: number): string | null {
  const active = [...cues].reverse().find((c) => elapsed >= c.at_seconds);
  // Cada palabra se queda ocho segundos y después la pantalla vuelve a estar limpia.
  if (!active || elapsed - active.at_seconds > 8) return null;
  return active.word;
}
