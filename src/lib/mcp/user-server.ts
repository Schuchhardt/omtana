import "server-only";
import { z } from "zod";
import { db } from "../supabase";
import { paymentsEnabled } from "../payments";
import { remainingFree } from "../queries";
import { CREDIT_COST_PER_MEDITATION, DURATIONS, LOCALES, PLAN } from "../config";
import { APP_VERSION } from "../version";
import { logEvent } from "../telemetry";
import { authenticateApiKey, type ApiKeyRow } from "./api-keys";
import { defineTool, ToolError, type McpServer } from "./protocol";
import { describeCatalog, loadCatalog } from "../meditations/catalog";
import { fromParams, fromPrompt, fromScript, paramsSchema, promptSchema, scriptSchema, type ActionContext } from "../meditations/actions";
import { loadMeditation, playerUrl, viewMeditation, waitForMeditation } from "../meditations/view";
import { allowedOrigins } from "./origins";
import type { Meditation, User } from "../types";

/**
 * MCP para las personas: lo que hace la web, pedido desde un asistente.
 *
 * `POST /api/mcp` con `Authorization: Bearer omt_…` (la llave se crea en
 * /perfil). Todo pasa por la misma cuenta: cobra igual que la web, ve solo lo
 * suyo y devuelve siempre el link del reproductor.
 */

export interface UserContext {
  user: User;
  key: ApiKeyRow;
  origin: string;
  site: string;
}

const tool = defineTool<UserContext>();

function actionContext(ctx: UserContext): ActionContext {
  return { owner: ctx.user, origin: ctx.origin, site: ctx.site, via: "mcp", charge: true, admin: false };
}

async function ownMeditation(ctx: UserContext, id: string): Promise<Meditation> {
  const meditation = await loadMeditation(id);
  if (!meditation || meditation.user_id !== ctx.user.id) {
    throw new ToolError(`No encontré una meditación tuya con id ${id}. list_my_meditations muestra las tuyas.`);
  }
  return meditation;
}

const getAccount = tool({
  name: "get_account",
  title: "Mi cuenta",
  description:
    "Tu cuenta en Omtana: plan, cupo del mes, créditos, valores por defecto (voz, duración, idioma) y cuánto cuesta generar. Empieza por acá.",
  input: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(_args, ctx) {
    const u = ctx.user;
    const billing = paymentsEnabled();
    const free = remainingFree(u);
    const voice = u.default_voice_id
      ? (await db().from("omtana_voices").select("slug, name").eq("id", u.default_voice_id).maybeSingle()).data
      : null;
    return {
      name: u.name,
      email: u.email,
      plan: u.plan,
      billing: billing
        ? {
            free_left_this_month: Number.isFinite(free) ? free : "ilimitado",
            credits: u.credits,
            cost_per_meditation: u.plan === "pro" ? 0 : CREDIT_COST_PER_MEDITATION,
            how: u.plan === "pro"
              ? "Pro: generar no descuenta nada."
              : `Free: primero se usan las ${PLAN.free.monthlyCustomizations} personalizaciones del mes, después un crédito por sesión. Si una generación falla, se devuelve.`,
          }
        : { note: "Los pagos no están activos: generar no descuenta nada." },
      defaults: {
        voice: voice ?? null,
        duration_minutes: u.default_duration,
        locale: u.locale,
        visibility: u.prefs?.publish_by_default ? "public" : "private",
      },
      key: { name: ctx.key.name, prefix: ctx.key.prefix },
      links: { library: `${ctx.site}/biblioteca`, profile: `${ctx.site}/perfil`, plans: `${ctx.site}/planes` },
    };
  },
});

const listOptions = tool({
  name: "list_options",
  title: "Opciones para crear",
  description:
    "Lo que se puede elegir al crear: voces (con idiomas, género y tono), intenciones del banco, ejercicios de respiración (con qué voces están grabados) y pistas de música. Pasa locale para ver solo lo que sirve en ese idioma.",
  input: z.object({ locale: z.enum(["es", "en", "pt"]).optional() }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(args, ctx) {
    const catalog = await loadCatalog();
    return {
      durations_minutes: DURATIONS,
      locales: LOCALES.map((l) => l.code),
      ...describeCatalog(catalog, args.locale ?? ctx.user.locale),
      notes: {
        breathing: "La respiración es una pista aparte que suena antes: solo se puede elegir si está grabada con esa voz e idioma.",
        music: "music hornea la pista en el audio. Sin music, el reproductor ofrece el banco en vivo con su propio volumen.",
      },
    };
  },
});

const createWithParams = tool({
  name: "create_meditation",
  title: "Crear meditación con parámetros",
  description:
    "Crea una meditación personalizada: la intención, el contexto de la persona, duración, voz, respiración, música e idioma. El guion lo escribe Omtana para ese contexto. Cobra como la web (cupo del mes o un crédito). Devuelve el id y el player_url; con wait_seconds espera a que esté lista y trae el audio_url.",
  input: paramsSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  run: (args, ctx) => fromParams(actionContext(ctx), args),
});

const createWithScript = tool({
  name: "create_meditation_from_script",
  title: "Crear meditación con guion propio",
  description:
    'Crea una meditación con un guion que trae la persona, leído por la voz elegida, con la música y la respiración que quiera. Modo "completo" (por defecto): la meditación entera es el guion; "[pausa 10]" deja diez segundos de silencio. Modo "tramo": el texto reemplaza solo el tramo personalizado de una intención del banco. Cobra como cualquier generación y devuelve el player_url.',
  input: scriptSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  run: (args, ctx) => fromScript(actionContext(ctx), args),
});

const createFromPrompt = tool({
  name: "generate_from_prompt",
  title: "Generar desde un pedido libre",
  description:
    "Genera una meditación a partir de un pedido en lenguaje natural: Omtana elige intención, contexto, duración, voz, respiración y música, y la crea. Los campos que pases (voice, duration_minutes, music…) mandan sobre lo que interprete. Con dry_run=true solo muestra lo que elegiría, sin crear ni cobrar.",
  input: promptSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  run: (args, ctx) => fromPrompt(actionContext(ctx), args),
});

const getMeditation = tool({
  name: "get_meditation",
  title: "Ver una meditación",
  description:
    "Estado de una meditación tuya: en qué paso va, el player_url y, cuando está lista, el audio_url (MP3 directo, vence en 3 horas; vuelve a llamar para uno nuevo). Con wait_seconds espera a que termine. Con include_script trae el guion por tramos.",
  input: z.object({
    id: z.string().uuid(),
    wait_seconds: z.number().int().min(0).max(45).default(0),
    include_script: z.boolean().default(false),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(args, ctx) {
    await ownMeditation(ctx, args.id);
    const meditation = (await waitForMeditation(args.id, args.wait_seconds))!;
    return viewMeditation(meditation, { site: ctx.site, lang: ctx.user.locale, includeScript: args.include_script });
  },
});

const listMine = tool({
  name: "list_my_meditations",
  title: "Mis meditaciones",
  description: "Tus meditaciones, de la más nueva a la más vieja, con estado y player_url.",
  input: z.object({
    status: z.enum(["pending", "generating", "ready", "failed"]).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(args, ctx) {
    let query = db()
      .from("omtana_meditations")
      .select("id, title, status, duration_seconds, locale, visibility, created_at, ready_at, script_mode")
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: false })
      .limit(args.limit);
    if (args.status) query = query.eq("status", args.status);
    const { data } = await query;
    const rows = (data as Meditation[]) ?? [];
    return {
      count: rows.length,
      meditations: rows.map((m) => ({
        id: m.id,
        title: m.title,
        status: m.status,
        duration_minutes: Math.round(m.duration_seconds / 60),
        locale: m.locale,
        visibility: m.visibility,
        own_script: m.script_mode ?? null,
        created_at: m.created_at,
        player_url: playerUrl(ctx.site, m.id),
      })),
      library_url: `${ctx.site}/biblioteca`,
    };
  },
});

const setVisibility = tool({
  name: "set_visibility",
  title: "Publicar o hacer privada",
  description: "Cambia una meditación tuya entre private (solo tú) y public (entra al catálogo).",
  input: z.object({ id: z.string().uuid(), visibility: z.enum(["private", "public"]) }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, ctx) {
    await ownMeditation(ctx, args.id);
    const { error } = await db()
      .from("omtana_meditations")
      .update({ visibility: args.visibility })
      .eq("id", args.id)
      .eq("user_id", ctx.user.id);
    if (error) throw new Error(error.message);
    return { id: args.id, visibility: args.visibility, player_url: playerUrl(ctx.site, args.id) };
  },
});

const INSTRUCTIONS = `Omtana genera meditaciones guiadas: guion escrito para la persona, voz de un banco de actores, respiración guiada y música.

Cómo usar este servidor:
- Empieza con get_account (plan, cupo, valores por defecto) y list_options (voces, intenciones, respiración, música).
- Tres formas de crear: create_meditation (parámetros: intención + contexto), create_meditation_from_script (guion propio, "[pausa N]" para silencios) y generate_from_prompt (pedido libre; usa dry_run=true para mostrar la propuesta antes de cobrar).
- Crear cobra como la web: el cupo Free del mes o un crédito (Pro no paga). Si falla, se devuelve solo. Antes de crear varias, confirma con la persona.
- Toda creación devuelve player_url: dáselo siempre a la persona. La generación tarda 1–3 minutos; get_meditation con wait_seconds (hasta 45) espera y trae el audio_url (MP3 directo, vence en 3 horas).
- Las meditaciones privadas piden iniciar sesión en el reproductor; el audio_url funciona sin sesión.
- El contexto que la persona cuenta es sensible: úsalo solo para su meditación.`;

export const userServer: McpServer<UserContext> = {
  name: "omtana",
  title: "Omtana",
  version: APP_VERSION,
  instructions: INSTRUCTIONS,
  tools: [getAccount, listOptions, createWithParams, createWithScript, createFromPrompt, getMeditation, listMine, setVisibility],
  allowedOrigins: allowedOrigins(),
  async authenticate(request) {
    const auth = await authenticateApiKey(request);
    if (!auth) return null;
    const origin = new URL(request.url).origin;
    return {
      user: auth.user,
      key: auth.key,
      origin,
      site: (process.env.NEXT_PUBLIC_SITE_URL || origin).replace(/\/$/, ""),
    };
  },
  async onCall(info) {
    await logEvent({
      level: info.ok ? "info" : "warn",
      source: "mcp:user",
      message: `${info.tool} ${info.ok ? "ok" : "falló"}`,
      data: { tool: info.tool, ms: info.ms, args: info.argKeys, error: info.error ?? null, key: info.ctx.key.prefix },
      trace: { userId: info.ctx.user.id, via: "mcp" },
    });
  },
  onError(error, info) {
    console.error(`[omtana:mcp] ${info.tool} falló:`, error);
  },
};
