"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * La mezcla del reproductor: cuánta voz, cuánta música y qué pista de fondo.
 *
 * Es una preferencia de la persona y no de la meditación, así que vive en el
 * navegador y vuelve igual en la sesión siguiente. Se lee con
 * `useSyncExternalStore` en vez de un efecto porque el servidor tiene que
 * pintar los valores por defecto y el cliente los guardados sin que la
 * hidratación pelee, y de paso dos pestañas abiertas quedan sincronizadas.
 */
export interface Mix {
  voiceVolume: number;
  musicVolume: number;
  trackId: string | null;
}

export const DEFAULT_MIX: Mix = { voiceVolume: 1, musicVolume: 0.35, trackId: null };

const KEY = "omtana:mix";

const listeners = new Set<() => void>();
let cache: Mix = DEFAULT_MIX;
/** El texto crudo del que salió `cache`; `undefined` mientras no se ha leído. */
let cachedRaw: string | null | undefined;

function clamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function parse(raw: string | null): Mix {
  if (!raw) return DEFAULT_MIX;
  try {
    const saved = JSON.parse(raw);
    return {
      voiceVolume: clamp(saved.voiceVolume, DEFAULT_MIX.voiceVolume),
      musicVolume: clamp(saved.musicVolume, DEFAULT_MIX.musicVolume),
      trackId: typeof saved.trackId === "string" ? saved.trackId : null,
    };
  } catch {
    return DEFAULT_MIX;
  }
}

/** Devuelve siempre la misma referencia mientras el guardado no cambie. */
function read(): Mix {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Modo privado o almacenamiento bloqueado: la mezcla vive solo en memoria.
    return cache;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cache = parse(raw);
  }
  return cache;
}

function server(): Mix {
  return DEFAULT_MIX;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useMix(): [Mix, (patch: Partial<Mix>) => void] {
  const mix = useSyncExternalStore(subscribe, read, server);

  const update = useCallback((patch: Partial<Mix>) => {
    cache = { ...read(), ...patch };
    try {
      const raw = JSON.stringify(cache);
      localStorage.setItem(KEY, raw);
      cachedRaw = raw;
    } catch {
      /* Sin almacenamiento: la mezcla igual manda en esta sesión. */
    }
    listeners.forEach((notify) => notify());
  }, []);

  return [mix, update];
}
