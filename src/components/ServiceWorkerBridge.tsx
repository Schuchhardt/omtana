"use client";

import { useEffect } from "react";

/**
 * Registra el service worker y se encarga de que una pestaña abierta termine
 * viendo el último deploy.
 *
 * El worker nuevo se instala solo, pero queda esperando: quien le dice que tome
 * el control es esta pieza. Lo hace apenas puede, salvo que haya audio sonando
 * —alguien en medio de una meditación— y entonces espera a que pare o a que la
 * pestaña pase a segundo plano. Recargar a alguien a mitad de una sesión sería
 * peor que mostrarle un build de hace cinco minutos.
 *
 * En desarrollo no registra nada y además desregistra lo que hubiera: el cache
 * de `/_next/static` es incompatible con la recarga en caliente, y basta abrir
 * el sitio en producción y volver a localhost para arrastrar un worker vivo.
 */
export function ServiceWorkerBridge() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((reg) => void reg.unregister()));
      return;
    }

    /* Si ya había un worker al cargar, un cambio de controlador es un build
       nuevo tomando el mando. Si no lo había, es la primera instalación y no
       hay nada que refrescar. */
    const hadController = Boolean(navigator.serviceWorker.controller);
    let disposed = false;
    let reloading = false;
    const cleanups: Array<() => void> = [];

    const playing = () =>
      Array.from(document.querySelectorAll("audio, video")).some(
        (el) => !(el as HTMLMediaElement).paused,
      );

    const reloadWhenIdle = () => {
      if (!playing()) {
        window.location.reload();
        return;
      }

      const waiting = new AbortController();
      const retry = () => {
        if (playing()) return;
        waiting.abort();
        window.location.reload();
      };
      /* Los eventos de <audio> no burbujean: hay que escucharlos en captura. */
      const opts = { capture: true, signal: waiting.signal };
      document.addEventListener("pause", retry, opts);
      document.addEventListener("ended", retry, opts);
      document.addEventListener("visibilitychange", retry, { signal: waiting.signal });
      cleanups.push(() => waiting.abort());
    };

    const onControllerChange = () => {
      if (!hadController || reloading) return;
      reloading = true;
      reloadWhenIdle();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    cleanups.push(() =>
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange),
    );

    const promote = (worker: ServiceWorker | null) => {
      if (worker) worker.postMessage("omtana:skip-waiting");
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (disposed) return;

        promote(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const incoming = registration.installing;
          if (!incoming) return;
          incoming.addEventListener("statechange", () => {
            /* Sin controlador es la primera instalación: se activa sola. */
            if (incoming.state === "installed" && navigator.serviceWorker.controller) {
              promote(incoming);
            }
          });
        });

        /* Una pestaña que queda abierta horas no se entera de los deploys sola:
           hay que preguntar. Al volver a ella y cada cuarto de hora basta. */
        const check = () => void registration.update().catch(() => undefined);
        const onVisible = () => {
          if (document.visibilityState === "visible") check();
        };
        document.addEventListener("visibilitychange", onVisible);
        const timer = window.setInterval(check, 15 * 60 * 1000);

        cleanups.push(() => {
          document.removeEventListener("visibilitychange", onVisible);
          window.clearInterval(timer);
        });
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      cleanups.forEach((stop) => stop());
    };
  }, []);

  return null;
}
