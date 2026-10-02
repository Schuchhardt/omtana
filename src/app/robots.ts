import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

/**
 * Todo lo público queda abierto, también para los rastreadores de los motores
 * de respuesta (GPTBot, ClaudeBot, PerplexityBot, Google-Extended…): que
 * puedan leer Omtana es justo lo que queremos. Lo de la cuenta y la API no
 * tiene nada que indexar.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/home",
          "/biblioteca",
          "/perfil",
          "/personalizar",
          "/planes",
          "/offline",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
