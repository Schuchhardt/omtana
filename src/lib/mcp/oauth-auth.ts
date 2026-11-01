import "server-only";
import { db } from "../supabase";
import { rollPeriod } from "../auth";
import { siteUrlFor } from "../site";
import { AuthFailure, type AuthChallenge } from "./protocol";
import {
  ACCESS_FAILURE_TEXT,
  checkAccessToken,
  oauthConfig,
  resourceMetadataUrl,
  SCOPES,
  type GrantRecord,
  type ResourceKind,
} from "../oauth/core";
import { supabaseOAuthStore } from "../oauth/store";
import type { User } from "../types";

/**
 * El lado "servidor de recursos" de OAuth para los dos MCP: valida un access
 * token para *este* MCP (audiencia, RFC 8707) y arma el desafío del 401.
 */

/** Cada cuánto se anota el último uso del permiso: no hace falta en cada llamada. */
const TOUCH_EVERY_MS = 5 * 60_000;

export function challengeFor(request: Request, kind: ResourceKind): AuthChallenge {
  const cfg = oauthConfig(siteUrlFor(request));
  return { resourceMetadata: resourceMetadataUrl(cfg, kind), scope: SCOPES[kind] };
}

export async function userFromAccessToken(
  request: Request,
  token: string,
  kind: ResourceKind,
): Promise<{ user: User; grant: GrantRecord } | AuthFailure> {
  const cfg = oauthConfig(siteUrlFor(request));
  const check = await checkAccessToken(supabaseOAuthStore, token, cfg.resources[kind]);
  if (!check.ok) return new AuthFailure("invalid", ACCESS_FAILURE_TEXT[check.reason]);

  const { data } = await db().from("omtana_users").select("*").eq("id", check.grant.user_id).maybeSingle();
  if (!data) return new AuthFailure("invalid", "La cuenta de este token ya no existe.");

  if (!check.grant.last_used_at || Date.now() - Date.parse(check.grant.last_used_at) > TOUCH_EVERY_MS) {
    await supabaseOAuthStore.touchGrant(check.grant.id, new Date());
  }
  return { user: await rollPeriod(data as User), grant: check.grant };
}
