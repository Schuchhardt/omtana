import Image from "next/image";
import Link from "next/link";
import { Wave } from "@/components/Wave";
import { BreathCircle } from "@/components/BreathCircle";
import { Faq } from "@/components/Faq";
import { SiteFooter } from "@/components/SiteFooter";
import { PlanCards } from "@/components/PlanCards";
import { currentUser } from "@/lib/auth";
import { planSession } from "@/lib/session-plan";

const STEPS = [
  {
    n: "01",
    title: "Intención",
    body: "Eliges de un banco curado de intenciones, o escribes la tuya. Nunca partes de una pantalla en blanco.",
  },
  {
    n: "02",
    title: "Personalización",
    body: "Sobre esa base se intercalan tramos escritos para tu contexto. El resto ya está listo, así que la espera es corta.",
  },
  {
    n: "03",
    title: "Voz",
    body: "Eliges quién te habla. Acento, género y tono. Cada voz es un personaje consistente, no una casilla de configuración.",
  },
];

export default async function LandingPage() {
  const user = await currentUser();
  const anatomy = planSession(15);

  return (
    <main>
      <div className="om-shell">
        {/* Hero */}
        <section className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-center gap-14 pb-[76px] pt-[92px]">
          <div>
            <p className="om-eyebrow mb-6">Meditaciones generadas</p>
            <h1 className="mb-6 text-[clamp(38px,5vw,62px)] leading-[1.06]">
              No busques la meditación que más se acerque. Dinos qué necesitas hoy.
            </h1>
            <p className="mb-9 max-w-[46ch] text-[19px] leading-[1.6] text-muted">
              Omtana arma la meditación alrededor de tu caso: guion, voz y música. Cada
              sesión abre con respiración, porque es lo que te lleva antes al estado que
              buscas.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={user ? "/home" : "/acceso?modo=crear"} className="om-btn om-btn-solid">
                {user ? "Ir a mi inicio" : "Crear cuenta gratis"}
              </Link>
              <Link href="/catalogo" className="om-btn om-btn-ghost">
                Escuchar una de 5 minutos
              </Link>
            </div>
            <p className="mt-[18px] text-[14px] text-faint">
              Sin tarjeta. El catálogo público es gratis siempre.
            </p>
          </div>

          <BreathCircle>
            <Wave count={44} height={70} animate className="w-full" />
          </BreathCircle>
        </section>

        {/* Tres pasos */}
        <section className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-paper px-7 py-8">
              <div className="mb-[14px] text-[12px] uppercase tracking-[0.18em] text-clay">
                {s.n} — {s.title}
              </div>
              <p className="text-[16px] leading-[1.6] text-ink-soft">{s.body}</p>
            </div>
          ))}
        </section>

        {/* Respiración */}
        <section className="mt-24 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-center gap-12">
          <div>
            <p className="om-eyebrow mb-[18px]">La respiración primero</p>
            <h2 className="mb-[18px] text-[clamp(26px,3.4vw,36px)]">
              Cada sesión abre con uno o dos ejercicios de respiración
            </h2>
            <p className="max-w-[50ch] text-[17px] leading-[1.65] text-muted">
              No es un adorno de entrada. Hay literatura que muestra que ciertos patrones
              respiratorios llevan al cuerpo a un estado de relajación más rápido que la
              instrucción verbal sola. Por eso el patrón viene antes del guion, y no al
              revés.
            </p>
          </div>

          <div className="om-card px-[30px] py-[34px]">
            <div className="om-label mb-[22px]">Anatomía de una sesión de 15 minutos</div>
            <div className="flex flex-col gap-[14px]">
              {anatomy.map((s) => (
                <div key={s.position} className="flex items-center gap-[14px]">
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{
                      background:
                        s.kind === "dynamic" ? "var(--color-clay)" : "var(--color-clay-bar)",
                    }}
                  />
                  <span className="mr-auto text-[16px]">{s.label}</span>
                  <span className="text-[14px] text-faint">{s.minutes} min</span>
                </div>
              ))}
            </div>
            <div className="my-[22px] h-px bg-line-hair" />
            <p className="text-[14px] leading-[1.55] text-faint">
              Los bloques claros ya existen. Solo el punto de color se escribe para ti, y
              por eso la generación toma menos de un minuto.
            </p>
          </div>
        </section>

        {/* Precio */}
        <section className="mt-24">
          <p className="om-eyebrow mb-[14px]">Precio</p>
          <h2 className="mb-3 text-[clamp(26px,3.4vw,36px)]">
            Personalizar cuesta, así que se cobra
          </h2>
          <p className="mb-9 max-w-[54ch] text-[17px] leading-[1.6] text-muted">
            Escuchar el catálogo es gratis. Generar una meditación consume tokens y
            síntesis de voz, y el precio lo refleja sin rodeos.
          </p>
          <PlanCards currentPlan={user?.plan ?? null} />
        </section>

        {/* FAQ */}
        <section className="mt-24 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-12">
          <div>
            <p className="om-eyebrow mb-[14px]">Preguntas</p>
            <h2 className="text-[clamp(26px,3.4vw,36px)]">Lo que nos preguntan antes de entrar</h2>
          </div>
          <Faq />
        </section>

        {/* YouTube */}
        <section
          id="youtube"
          className="mt-24 grid scroll-mt-24 grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-center gap-10 rounded-card bg-ink p-[clamp(36px,5vw,64px)]"
        >
          <div>
            <p className="mb-4 text-[13px] uppercase tracking-[0.2em] text-night-muted">
              También en YouTube
            </p>
            <h2 className="mb-[14px] text-[clamp(26px,3.2vw,34px)] text-sand">
              Las mismas meditaciones, en video
            </h2>
            <p className="max-w-[46ch] text-[17px] leading-[1.6] text-night-text">
              Onda de audio, palabras clave y música. Publicamos sesiones completas cada
              semana, gratis y sin cuenta.
            </p>
          </div>

          <div className="flex flex-col items-start gap-3">
            <div className="relative flex aspect-video w-full items-center justify-center rounded-[3px] border border-night-line bg-night px-[14%]">
              <Image
                src="/brand/omtana-wordmark-white.svg"
                alt="Omtana"
                width={54}
                height={11}
                className="absolute left-[18px] top-[18px] h-[11px] w-auto opacity-50"
              />
              <Wave count={40} height={46} color="var(--color-night-bar)" animate className="w-full" />
            </div>
            <p className="font-mono text-[13px] text-[#8b8074]">frame exportado · 1920×1080</p>
          </div>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
