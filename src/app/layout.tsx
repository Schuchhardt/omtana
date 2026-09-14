import type { Metadata, Viewport } from "next";
import { Jost } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SetupNotice } from "@/components/SetupNotice";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";

const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--font-jost",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = copy(await getLang()).meta;

  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: {
      default: t.title,
      template: "%s · Omtana",
    },
    description: t.description,
    icons: { icon: "/brand/omtana-symbol-black.svg" },
    openGraph: {
      title: t.title,
      description: t.ogDescription,
      type: "website",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#F6F1E9",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();

  return (
    <html lang={lang} className={jost.variable}>
      <body className="min-h-screen font-sans">
        <SetupNotice />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
