import Image from "next/image";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthForm } from "./AuthForm";
import { BreathCircle } from "@/components/BreathCircle";
import { currentUser } from "@/lib/auth";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: copy(await getLang()).meta.titles.access };
}

export default async function AccesoPage({
  searchParams,
}: {
  searchParams: Promise<{ modo?: string }>;
}) {
  if (await currentUser()) redirect("/home");

  const [{ modo }, lang] = await Promise.all([searchParams, getLang()]);
  const mode = modo === "crear" ? "crear" : "entrar";
  const t = copy(lang).access;


  return (
    <main className="om-shell grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-center gap-16 pb-24 pt-16">
      <AuthForm mode={mode} t={t} />

      <div className="w-full max-w-[460px] justify-self-center">
        <BreathCircle>
          <div className="flex flex-col items-center gap-[26px] text-center">
            <Image
              src="/brand/omtana-symbol-black.svg"
              alt=""
              width={56}
              height={56}
              className="block h-14 w-14"
            />
            <p className="text-[22px] font-light leading-[1.5] text-ink-soft">{t.aside}</p>
          </div>
        </BreathCircle>
      </div>
    </main>
  );
}
