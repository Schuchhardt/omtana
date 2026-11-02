import "server-only";
import { db } from "../supabase";
import { paymentsEnabled } from "../payments";

/**
 * Devuelve lo cobrado por una generación fallida, una sola vez.
 *
 * Antes vivía dentro de `/status` y se disparaba cuando la persona miraba su
 * sesión fallida desde la web. Con el MCP eso ya no alcanza: un asistente
 * puede encargar una sesión y no volver a abrirla nunca en el navegador. Así
 * que es una función que llaman `/status` y las herramientas MCP que leen el
 * estado.
 *
 * Solo devuelve lo que de verdad se cobró (un movimiento negativo ligado a la
 * sesión): una sesión de Pro, o generada sin pagos configurados, no tiene nada
 * que devolver. El saldo se lee al momento de devolver, no se arrastra de la
 * petición, para no pisar un crédito comprado entre medio.
 */
export async function refundFailedGeneration(meditationId: string): Promise<boolean> {
  if (!paymentsEnabled()) return false;

  const { data: meditation } = await db()
    .from("omtana_meditations")
    .select("id, user_id, status")
    .eq("id", meditationId)
    .maybeSingle();
  if (!meditation || meditation.status !== "failed" || !meditation.user_id) return false;

  const { data: rows } = await db()
    .from("omtana_credit_ledger")
    .select("delta")
    .eq("meditation_id", meditationId);
  const movements = (rows as { delta: number }[] | null) ?? [];
  if (movements.some((r) => r.delta > 0)) return false;

  const charged = movements.filter((r) => r.delta < 0).reduce((n, r) => n - r.delta, 0);
  if (charged <= 0) return false;

  const { error } = await db().from("omtana_credit_ledger").insert({
    user_id: meditation.user_id,
    delta: charged,
    reason: "Devolución por generación fallida",
    reason_key: "refund_failed",
    meditation_id: meditationId,
  });
  if (error) return false;

  const { data: owner } = await db()
    .from("omtana_users")
    .select("credits")
    .eq("id", meditation.user_id)
    .maybeSingle();
  await db()
    .from("omtana_users")
    .update({ credits: ((owner?.credits as number | undefined) ?? 0) + charged })
    .eq("id", meditation.user_id);

  return true;
}
