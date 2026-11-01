import "server-only";
import { z } from "zod";
import { db } from "../supabase";
import { localized } from "../i18n";
import { breathingSlotSeconds, type BreathingExercise } from "../breathing";
import { planSession, wordTarget } from "../session-plan";
import { recordAnthropicUsage } from "../telemetry";
import {
  MAX_SCRIPT_CHARS,
  estimateScriptSeconds,
  nearestDuration,
  scriptAsPlainText,
} from "../generation/custom-script";
import { ToolError } from "../mcp/protocol";
import { createMeditation, type CreatedVia, type NewMeditation } from "./create";
import {
  breathingFor,
  breathingRender,
  findBreathing,
  findIntention,
  findMusic,
  findVoice,
  loadCatalog,
  voiceUsable,
  voicesFor,
  type Catalog,
} from "./catalog";
import { interpretPrompt, NO_BREATHING, PromptRefusedError, PROMPT_MODEL } from "./interpret";
import { loadMeditation, viewMeditation, waitForMeditation } from "./view";
import type { MusicTrack, User, Visibility, Voice } from "../types";

/**
 * Las tres formas de pedir una meditación desde un asistente, compartidas por
 * el MCP de usuarios y el de administración:
 *
 * - con parámetros (`fromParams`): intención, contexto, duración, voz…
 * - con guion propio (`fromScript`): el texto lo trae la persona.
 * - desde un pedido libre (`fromPrompt`): el modelo elige los parámetros.
 *
 * Las tres terminan en `createMeditation`, igual que la web, y devuelven la
 * vista de la sesión con su link.
 */

export interface ActionContext {
  /** Dueño de la meditación. Null: catálogo (solo admin). */
  owner: User | null;
  origin: string;
  site: string;
  via: CreatedVia;
  /** Si se descuenta cupo o crédito. */
  charge: boolean;
  admin: boolean;
}

/** Cuántas sesiones puede tener una persona generándose a la vez por MCP. */
export const MAX_ACTIVE_PER_USER = 3;
/** Cuántos pedidos libres puede interpretar una persona por hora. */
export const MAX_PROMPTS_PER_HOUR = 30;

/* ───────────────────────────── esquemas ───────────────────────────── */

const duration = z.literal([5, 10, 15, 20]);
const locale = z.enum(["es", "en", "pt"]);

export const commonFields = {
  voice: z
    .string()
    .trim()
    .max(80)
    .optional()
    .describe("Slug, nombre o id de la voz (ver list_options). Por defecto, la de tu perfil o la primera que hable el idioma."),
  locale: locale.optional().describe("Idioma de la meditación. Por defecto, el de tu perfil."),
  breathing: z
    .string()
    .trim()
    .max(80)
    .optional()
    .describe('Ejercicio de respiración que suena antes (slug de list_options). "ninguna" para no usar. Vacío: el recomendado para esa voz.'),
  music: z
    .string()
    .trim()
    .max(80)
    .optional()
    .describe("Pista de música (slug de list_options) que se hornea en el audio. Sin esto el audio va sin música y el reproductor ofrece el banco en vivo."),
  visibility: z
    .enum(["private", "public"])
    .optional()
    .describe("private: solo tú. public: entra al catálogo. Por defecto, lo que diga tu perfil."),
  wait_seconds: z
    .number()
    .int()
    .min(0)
    .max(45)
    .default(0)
    .describe("Segundos a esperar a que termine antes de responder (0–45). Con 0 vuelve al tiro con el link; después consulta get_meditation."),
};

export const paramsFields = {
  intention: z
    .string()
    .trim()
    .min(3)
    .max(160)
    .optional()
    .describe("Qué quiere trabajar la persona, en una frase. Obligatorio si no hay intention_slug."),
  intention_slug: z
    .string()
    .trim()
    .max(80)
    .optional()
    .describe("Intención del banco (list_options). Reutiliza su plantilla: sale más rápido."),
  context: z
    .string()
    .trim()
    .max(600)
    .default("")
    .describe("Lo concreto del caso: con esto se escribe el tramo personalizado."),
  duration_minutes: duration.optional().describe("5, 10, 15 o 20. Por defecto, la de tu perfil."),
  title: z.string().trim().max(90).optional(),
  ...commonFields,
};

/** Las reglas que cruzan campos van aparte: zod no extiende un objeto refinado. */
export function paramsRules<T extends z.ZodType<{ intention?: string; intention_slug?: string }>>(schema: T) {
  return schema.refine((v) => v.intention || v.intention_slug, {
    message: "Falta intention o intention_slug.",
    path: ["intention"],
  });
}

export const paramsSchema = paramsRules(z.object(paramsFields));

export const scriptFields = {
  script: z
    .string()
    .trim()
    .min(40)
    .max(MAX_SCRIPT_CHARS)
    .describe(
      'El guion tal cual lo dirá la voz, sin acotaciones. "[pausa 10]" deja diez segundos de silencio (sin número, cinco). Una línea en blanco entre párrafos deja dos. Usa "..." para pausas cortas.',
    ),
  mode: z
    .enum(["completo", "tramo"])
    .default("completo")
    .describe(
      "completo: la meditación entera es tu guion y dura lo que dura leerlo. tramo: tu texto reemplaza solo el tramo personalizado y el resto sale de la plantilla de la intención (necesita intention o intention_slug y duration_minutes).",
    ),
  title: z.string().trim().min(2).max(90).optional().describe("Título. Por defecto, la intención o el comienzo del guion."),
  intention: z.string().trim().min(3).max(160).optional(),
  intention_slug: z.string().trim().max(80).optional(),
  duration_minutes: duration.optional().describe("Solo en modo tramo."),
  ...commonFields,
};

export function scriptRules<
  T extends z.ZodType<{ mode: "completo" | "tramo"; script: string; intention?: string; intention_slug?: string }>,
>(schema: T) {
  return schema
    .refine((v) => v.mode === "completo" || v.intention || v.intention_slug, {
      message: "El modo tramo necesita intention o intention_slug.",
      path: ["intention"],
    })
    .refine((v) => v.mode === "completo" || v.script.length <= 4000, {
      message: "En modo tramo el texto va hasta 4000 caracteres: es un tramo de la sesión, no la sesión entera.",
      path: ["script"],
    });
}

export const scriptSchema = scriptRules(z.object(scriptFields));

export const promptFields = {
  prompt: z
    .string()
    .trim()
    .min(5)
    .max(2000)
    .describe('El pedido en palabras de la persona, p. ej. "10 minutos para dormir, voz masculina grave, con lluvia de fondo; mañana tengo una entrevista y no paro de pensar".'),
  dry_run: z
    .boolean()
    .default(false)
    .describe("true: solo devuelve los parámetros que elegiría, sin crear ni cobrar."),
  duration_minutes: duration.optional().describe("Fuerza la duración, diga lo que diga el pedido."),
  ...commonFields,
};

export const promptSchema = z.object(promptFields);

/* ───────────────────────────── resolución ───────────────────────────── */

interface Resolved {
  locale: "es" | "en" | "pt";
  voice: Voice;
  breathing: BreathingExercise | null;
  music: MusicTrack | null;
  visibility: Visibility;
}

function slugList(rows: { slug: string }[]): string {
  return rows.map((r) => r.slug).join(", ") || "(ninguna)";
}

function resolveCommon(
  catalog: Catalog,
  ctx: ActionContext,
  args: { voice?: string; locale?: "es" | "en" | "pt"; breathing?: string; music?: string; visibility?: Visibility },
  durationMinutes: number,
  warnings: string[],
): Resolved {
  let lang = (args.locale ?? (ctx.owner?.locale as "es" | "en" | "pt" | undefined) ?? "es") as Resolved["locale"];

  let voice: Voice | null = null;
  if (args.voice) {
    voice = findVoice(catalog, args.voice);
    if (!voice) {
      throw new ToolError(`No existe la voz "${args.voice}".`, { voces: slugList(catalog.voices) });
    }
    if (!voice.provider_voice_id) {
      throw new ToolError(`La voz "${voice.name}" todavía no está disponible.`, { voces: slugList(voicesFor(catalog, lang)) });
    }
    if (!voice.languages.includes(lang)) {
      if (args.locale) {
        throw new ToolError(`La voz "${voice.name}" no habla "${lang}".`, {
          voces_en_ese_idioma: slugList(voicesFor(catalog, lang)),
        });
      }
      warnings.push(`La voz ${voice.name} no habla "${lang}": la meditación va en "${voice.languages[0]}".`);
      lang = voice.languages[0] as Resolved["locale"];
    }
  } else {
    const preferred = catalog.voices.find((v) => v.id === ctx.owner?.default_voice_id);
    voice = preferred && voiceUsable(preferred, lang) ? preferred : (voicesFor(catalog, lang)[0] ?? null);
    if (!voice) throw new ToolError(`No hay voces disponibles en "${lang}".`);
  }

  const slot = breathingSlotSeconds(durationMinutes);
  let breathing: BreathingExercise | null = null;
  const wanted = args.breathing?.trim();
  if (wanted && ["ninguna", "ninguno", "none", "no", NO_BREATHING].includes(wanted.toLowerCase())) {
    breathing = null;
  } else if (wanted) {
    breathing = findBreathing(catalog, wanted);
    if (!breathing) {
      throw new ToolError(`No existe el ejercicio "${wanted}".`, { ejercicios: slugList(catalog.breathing) });
    }
    if (!breathingRender(catalog, breathing.id, voice.id, lang, slot)) {
      const options = breathingFor(catalog, voice.id, lang, slot);
      warnings.push(
        `"${breathing.name}" no está grabado con ${voice.name} en "${lang}" para esta duración: va sin respiración.` +
          (options.length ? ` Con esa voz hay: ${slugList(options)}.` : ""),
      );
      breathing = null;
    }
  } else {
    breathing = breathingFor(catalog, voice.id, lang, slot)[0] ?? null;
  }

  let music: MusicTrack | null = null;
  if (args.music?.trim()) {
    const key = args.music.trim().toLowerCase();
    if (!["ninguna", "none", "no"].includes(key)) {
      music = findMusic(catalog, args.music);
      if (!music) throw new ToolError(`No existe la pista "${args.music}".`, { musica: slugList(catalog.music) });
    }
  }

  const visibility: Visibility =
    args.visibility ?? (ctx.owner ? (ctx.owner.prefs?.publish_by_default ? "public" : "private") : "public");

  return { locale: lang, voice, breathing, music, visibility };
}

function defaultDuration(ctx: ActionContext): 5 | 10 | 15 | 20 {
  const d = ctx.owner?.default_duration;
  return d === 5 || d === 10 || d === 15 || d === 20 ? d : 10;
}

async function guardActive(ctx: ActionContext): Promise<void> {
  if (!ctx.owner || ctx.admin) return;
  const { count } = await db()
    .from("omtana_meditations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.owner.id)
    .in("status", ["pending", "generating"]);
  if ((count ?? 0) >= MAX_ACTIVE_PER_USER) {
    throw new ToolError(
      `Ya tienes ${count} sesiones generándose. Espera a que alguna termine (get_meditation) antes de pedir otra.`,
    );
  }
}

async function guardPromptRate(ctx: ActionContext): Promise<void> {
  if (!ctx.owner || ctx.admin) return;
  const { count, error } = await db()
    .from("omtana_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.owner.id)
    .eq("operation", "prompt")
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if (!error && (count ?? 0) >= MAX_PROMPTS_PER_HOUR) {
    throw new ToolError(
      `Llegaste a ${MAX_PROMPTS_PER_HOUR} pedidos libres en la última hora. Usa create_meditation con parámetros o espera un rato.`,
    );
  }
}

const NEXT_STEP =
  "Se está generando: suele tardar uno a tres minutos (la primera de una intención, algo más). " +
  "Comparte player_url, o llama a get_meditation con wait_seconds para recibir el audio_url cuando esté lista.";

async function finish(
  ctx: ActionContext,
  meditation: NewMeditation,
  waitSeconds: number,
  warnings: string[],
  extra: Record<string, unknown> = {},
) {
  await guardActive(ctx);
  const result = await createMeditation({
    user: ctx.owner,
    // Sin dueño es catálogo del equipo, como lo que genera el CLI.
    meditation: { ...meditation, source: ctx.owner ? "user" : "curated" },
    origin: ctx.origin,
    via: ctx.via,
    charge: ctx.charge,
  });
  if (!result.ok) {
    throw new ToolError(
      result.code === "out_of_credits"
        ? "No te quedan personalizaciones del mes ni créditos. Puedes comprar en /planes."
        : result.message,
      result.code === "out_of_credits" ? { planes: `${ctx.site}/planes` } : undefined,
    );
  }

  const row = waitSeconds > 0 ? await waitForMeditation(result.id, waitSeconds) : await loadMeditation(result.id);
  const view = row
    ? await viewMeditation(row, { site: ctx.site, admin: ctx.admin })
    : { id: result.id, player_url: `${ctx.site}/reproductor/${result.id}` };

  return {
    meditation: view,
    charged: result.charged,
    ...(warnings.length ? { warnings } : {}),
    ...extra,
    ...(view.status === "ready" ? {} : { next: NEXT_STEP }),
  };
}

/* ───────────────────────────── acciones ───────────────────────────── */

export async function fromParams(ctx: ActionContext, args: z.output<typeof paramsSchema>) {
  const catalog = await loadCatalog();
  const warnings: string[] = [];
  const minutes = args.duration_minutes ?? defaultDuration(ctx);

  const intention = args.intention_slug ? findIntention(catalog, args.intention_slug) : null;
  if (args.intention_slug && !intention) {
    throw new ToolError(`No existe la intención "${args.intention_slug}".`, { intenciones: slugList(catalog.intentions) });
  }

  const r = resolveCommon(catalog, ctx, args, minutes, warnings);
  const text = args.intention || (intention ? localized(intention, r.locale, "title") : "");

  return finish(
    ctx,
    {
      intention: text,
      intentionSlug: intention?.slug ?? null,
      context: args.context,
      durationMinutes: minutes,
      locale: r.locale,
      voiceId: r.voice.id,
      breathingExerciseId: r.breathing?.id ?? null,
      musicTrackId: r.music?.id ?? null,
      visibility: r.visibility,
      title: args.title ?? null,
    },
    args.wait_seconds,
    warnings,
  );
}

export async function fromScript(ctx: ActionContext, args: z.output<typeof scriptSchema>) {
  const catalog = await loadCatalog();
  const warnings: string[] = [];

  const intention = args.intention_slug ? findIntention(catalog, args.intention_slug) : null;
  if (args.intention_slug && !intention) {
    throw new ToolError(`No existe la intención "${args.intention_slug}".`, { intenciones: slugList(catalog.intentions) });
  }

  if (args.mode === "completo") {
    const seconds = estimateScriptSeconds(args.script);
    // El hueco de respiración se elige como si fuera la duración más cercana del menú.
    const minutes = nearestDuration(seconds);
    const r = resolveCommon(catalog, ctx, args, minutes, warnings);
    const firstWords = scriptAsPlainText(args.script).split(/\s+/).slice(0, 8).join(" ");
    const text =
      args.intention || (intention ? localized(intention, r.locale, "title") : args.title || `${firstWords}…`);
    if (seconds < 60) warnings.push(`El guion dura cerca de ${seconds} s leído: es una sesión muy corta.`);

    return finish(
      ctx,
      {
        intention: text.slice(0, 160),
        intentionSlug: intention?.slug ?? null,
        context: "",
        durationMinutes: minutes,
        estimatedSeconds: seconds,
        locale: r.locale,
        voiceId: r.voice.id,
        breathingExerciseId: r.breathing?.id ?? null,
        musicTrackId: r.music?.id ?? null,
        visibility: r.visibility,
        title: args.title ?? text,
        scriptMode: "completo",
        scriptOverride: args.script,
      },
      args.wait_seconds,
      warnings,
      { estimated_minutes: Math.round(seconds / 6) / 10 },
    );
  }

  // Tramo: el texto reemplaza el tramo personalizado de la plantilla.
  const minutes = args.duration_minutes ?? defaultDuration(ctx);
  const r = resolveCommon(catalog, ctx, args, minutes, warnings);
  const dynamic = planSession(minutes).find((s) => s.kind === "dynamic");
  const target = dynamic ? wordTarget(dynamic) : 0;
  const words = scriptAsPlainText(args.script).split(/\s+/).filter(Boolean).length;
  if (target && words < target * 0.5) {
    warnings.push(`El tramo de ${minutes} min pide unas ${target} palabras y trajiste ${words}: va a quedar con mucho silencio.`);
  } else if (target && words > target * 1.5) {
    warnings.push(`El tramo de ${minutes} min pide unas ${target} palabras y trajiste ${words}: la sesión va a durar más de ${minutes} min.`);
  }
  const text = args.intention || localized(intention!, r.locale, "title");

  return finish(
    ctx,
    {
      intention: text,
      intentionSlug: intention?.slug ?? null,
      context: "",
      durationMinutes: minutes,
      locale: r.locale,
      voiceId: r.voice.id,
      breathingExerciseId: r.breathing?.id ?? null,
      musicTrackId: r.music?.id ?? null,
      visibility: r.visibility,
      title: args.title ?? null,
      scriptMode: "tramo",
      scriptOverride: args.script,
    },
    args.wait_seconds,
    warnings,
    { target_words: target, words },
  );
}

export async function fromPrompt(ctx: ActionContext, args: z.output<typeof promptSchema>) {
  await guardPromptRate(ctx);
  const catalog = await loadCatalog();
  if (!catalog.voices.some((v) => v.provider_voice_id)) {
    throw new ToolError("No hay voces disponibles todavía.");
  }

  const startedAt = Date.now();
  let interpreted;
  try {
    interpreted = await interpretPrompt({
      prompt: args.prompt,
      catalog,
      locale: args.locale ?? ctx.owner?.locale ?? "es",
    });
  } catch (err) {
    if (err instanceof PromptRefusedError) throw new ToolError(err.message);
    throw err;
  }
  const { interpretation: i } = interpreted;

  // Lo que la persona fijó a mano manda sobre lo que el modelo leyó.
  const minutes = args.duration_minutes ?? i.durationMinutes ?? defaultDuration(ctx);
  const choice = {
    voice: args.voice ?? i.voice,
    locale: args.locale ?? i.locale,
    breathing: args.breathing ?? i.breathing ?? undefined,
    music: args.music ?? i.music ?? undefined,
    visibility: args.visibility,
  };
  const warnings: string[] = [];
  const intention = i.intentionSlug ? findIntention(catalog, i.intentionSlug) : null;
  const r = resolveCommon(catalog, ctx, choice, minutes, warnings);

  const interpretedView = {
    title: i.title,
    intention: i.intention,
    intention_slug: intention?.slug ?? null,
    context: i.context,
    duration_minutes: minutes,
    locale: r.locale,
    voice: r.voice.slug,
    breathing: r.breathing?.slug ?? "ninguna",
    music: r.music?.slug ?? "ninguna",
    visibility: r.visibility,
    notes: i.notes,
  };

  const usage = (meditationId: string | null) =>
    recordAnthropicUsage({
      operation: "prompt",
      requestedModel: interpreted.model ?? PROMPT_MODEL,
      response: interpreted.response,
      startedAt,
      trace: { userId: ctx.owner?.id ?? null, via: ctx.via, meditationId },
    });

  if (args.dry_run) {
    await usage(null);
    return {
      interpreted: interpretedView,
      ...(warnings.length ? { warnings } : {}),
      next: "Nada se creó ni se cobró. Llama de nuevo con dry_run=false (y los ajustes que quieras) para generarla.",
    };
  }

  let created;
  try {
    created = await finish(
      ctx,
      {
        intention: i.intention || i.title || args.prompt.slice(0, 160),
        intentionSlug: intention?.slug ?? null,
        context: i.context,
        durationMinutes: minutes,
        locale: r.locale,
        voiceId: r.voice.id,
        breathingExerciseId: r.breathing?.id ?? null,
        musicTrackId: r.music?.id ?? null,
        visibility: r.visibility,
        title: i.title || null,
      },
      args.wait_seconds,
      warnings,
      { interpreted: interpretedView },
    );
  } catch (err) {
    await usage(null);
    throw err;
  }
  await usage(String((created.meditation as { id?: unknown }).id ?? "") || null);
  return created;
}
