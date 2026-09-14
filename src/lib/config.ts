/**
 * Parámetros de producto. Los números vienen del documento v1 y del diseño;
 * están acá para cambiarlos en un solo lugar cuando se definan de verdad.
 */
export const PLAN = {
  free: {
    id: "free" as const,
    tag: "Free",
    price: "$0",
    per: "para siempre",
    /** Personalizaciones incluidas al mes. Pendiente de definir: 1 o 3. */
    monthlyCustomizations: 3,
    features: [
      "Catálogo público completo",
      "3 personalizaciones al mes",
      "Puedes publicar lo que generas",
    ],
    cta: "Tu plan actual",
  },
  pro: {
    id: "pro" as const,
    tag: "Pro",
    price: "$59",
    per: "al mes",
    monthlyCustomizations: Infinity,
    features: [
      "Generación ilimitada",
      "Voces nuevas antes que el resto",
      "Sesiones de hasta 20 minutos",
    ],
    cta: "Pasar a Pro",
  },
} as const;

export const CREDITS_PLAN = {
  tag: "Créditos",
  price: "$3",
  per: "por meditación",
  features: [
    "Pagas solo cuando generas",
    "La meditación queda tuya",
    "Sin suscripción",
  ],
  cta: "Comprar créditos",
} as const;

/** Los rótulos (`qty`, `unit`) viven en el diccionario, indexados por `id`. */
export const CREDIT_PACKS = [
  { id: "pack_1", credits: 1, price: "$3", amountUsd: 300 },
  { id: "pack_5", credits: 5, price: "$12", amountUsd: 1200 },
  { id: "pack_15", credits: 15, price: "$30", amountUsd: 3000 },
] as const;

export const DURATIONS = [5, 10, 15, 20] as const;
export type Duration = (typeof DURATIONS)[number];

export const LOCALES = [
  { code: "es", label: "ES", full: "Español", meditationLabel: "Español" },
  { code: "en", label: "EN", full: "English", meditationLabel: "English" },
  { code: "pt", label: "PT", full: "Português", meditationLabel: "Português" },
] as const;
export type Locale = (typeof LOCALES)[number]["code"];

export const SESSION_COOKIE = "omtana_session";
export const SESSION_DAYS = 30;

/** Costo en créditos de una personalización. */
export const CREDIT_COST_PER_MEDITATION = 1;
