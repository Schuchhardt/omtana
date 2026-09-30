import type { Metadata, Viewport } from "next";
import { Jost } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SetupNotice } from "@/components/SetupNotice";
import { ServiceWorkerBridge } from "@/components/ServiceWorkerBridge";
import { getLang } from "@/lib/lang";
import { copy } from "@/lib/i18n";
import { OG_LOCALE, SITE_URL, ogImage } from "@/lib/seo";

const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--font-jost",
});

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const t = copy(lang).meta;

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t.title,
      template: "%s · Omtana",
    },
    description: t.description,
    applicationName: "Omtana",
    icons: {
      icon: "/brand/omtana-symbol-black.svg",
      apple: "/icons/apple-touch-icon.png",
    },
    /**
     * Instalada en iOS se abre sin barra de Safari y la barra de estado toma el
     * color de la arena, como el resto de la app. El manifiesto cubre el mismo
     * caso en Android; iOS todavía necesita estas dos.
     */
    appleWebApp: {
      capable: true,
      title: "Omtana",
      statusBarStyle: "default",
    },
    // Las páginas públicas reemplazan esto con su URL y su hreflang (ver
    // `publicMetadata`); esto queda de respaldo para el resto.
    openGraph: {
      title: t.title,
      description: t.ogDescription,
      siteName: "Omtana",
      type: "website",
      locale: OG_LOCALE[lang],
      images: [ogImage(lang)],
    },
    twitter: { card: "summary_large_image", images: [ogImage(lang)] },
    /** Fragmentos largos y vista previa grande en los resultados de Google. */
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" },
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
        <ServiceWorkerBridge />
        <SetupNotice />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
