import type { MetadataRoute } from "next";

/**
 * Manifiesto de la PWA.
 *
 * A propósito sin `getLang()`: leer la cookie volvería la ruta dinámica y el
 * manifiesto se pide una vez, antes de que exista sesión. Queda en español,
 * que es el idioma de origen del producto.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Omtana · Meditaciones a tu medida",
    short_name: "Omtana",
    description: "Meditaciones generadas a partir de tu intención.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f1e9",
    theme_color: "#f6f1e9",
    lang: "es",
    dir: "ltr",
    categories: ["health", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android recorta este a la forma del launcher: lleva más aire alrededor.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Personalizar", url: "/personalizar" },
      { name: "Mi biblioteca", url: "/biblioteca" },
      { name: "Catálogo", url: "/catalogo" },
    ],
  };
}
