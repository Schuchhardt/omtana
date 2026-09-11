import type { Metadata, Viewport } from "next";
import { Jost } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";

const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--font-jost",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Omtana — Meditaciones generadas",
    template: "%s · Omtana",
  },
  description:
    "Omtana arma la meditación alrededor de tu caso: guion, voz y música. Cada sesión abre con respiración.",
  icons: { icon: "/brand/omtana-symbol-black.svg" },
  openGraph: {
    title: "Omtana — Meditaciones generadas",
    description:
      "No busques la meditación que más se acerque. Dinos qué necesitas hoy.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#F6F1E9",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={jost.variable}>
      <body className="min-h-screen font-sans">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
