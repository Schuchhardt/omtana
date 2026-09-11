import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Preferences } from "./Preferences";
import { SiteFooter } from "@/components/SiteFooter";
import { currentUser } from "@/lib/auth";
import { listVoices, userStats } from "@/lib/queries";
import { formatLongDate } from "@/lib/format";

export const metadata: Metadata = { title: "Mi perfil" };

export default async function PerfilPage() {
  const user = await currentUser();
  if (!user) redirect("/acceso");

  const [voices, stats] = await Promise.all([listVoices(), userStats(user.id)]);

  const cards = [
    { value: String(stats.completed), label: "sesiones completadas" },
    {
      value: stats.hours > 0 ? `${stats.hours} h ${stats.minutes}` : `${stats.minutes} min`,
      label: "escuchadas en total",
    },
    { value: String(stats.owned), label: "meditaciones tuyas" },
  ];

  return (
    <main>
      <div className="om-shell pb-24 pt-14">
        <div className="mb-12 flex flex-wrap items-center gap-[22px]">
          <span
            className="h-[76px] w-[76px] flex-none rounded-full border border-line-field bg-clay-pale"
            aria-hidden="true"
          />
          <div className="mr-auto">
            <h1 className="text-[clamp(26px,3.4vw,34px)]">{user.name}</h1>
            <p className="mt-1.5 text-[16px] text-muted-soft">
              {user.email} · Plan {user.plan === "pro" ? "Pro" : "Free"} · miembro desde{" "}
              {formatLongDate(user.created_at)}
            </p>
          </div>
          <Link href="/planes" className="om-btn om-btn-solid px-6 py-[13px] text-[15px]">
            Ver planes
          </Link>
        </div>

        <div className="mb-[14px] grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-[14px]">
          {cards.map((c) => (
            <div key={c.label} className="om-card px-6 py-[26px]">
              <div className="text-[34px] font-light tracking-[-0.02em]">{c.value}</div>
              <div className="mt-1 text-[15px] text-muted-soft">{c.label}</div>
            </div>
          ))}
        </div>

        <Preferences
          locale={user.locale}
          defaultVoiceId={user.default_voice_id}
          defaultDuration={user.default_duration}
          prefs={user.prefs}
          voices={voices}
        />
      </div>

      <SiteFooter />
    </main>
  );
}
