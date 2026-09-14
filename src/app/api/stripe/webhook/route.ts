import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { db } from "@/lib/supabase";

/** Stripe firma el cuerpo crudo: no lo parseamos antes de verificar. */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) {
    return NextResponse.json({ error: "Webhook sin configurar." }, { status: 503 });
  }

  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "firma inválida";
    return NextResponse.json({ error: `Firma inválida: ${message}` }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.metadata?.omtana_user_id ?? session.client_reference_id;
      if (!userId) break;

      // Idempotencia: si ya registramos este pago, no lo contamos dos veces.
      const { data: seen } = await db()
        .from("omtana_credit_ledger")
        .select("id")
        .eq("stripe_ref", session.id)
        .maybeSingle();
      if (seen) break;

      if (session.metadata?.kind === "pro") {
        await db().from("omtana_users").update({ plan: "pro" }).eq("id", userId);
        await db().from("omtana_credit_ledger").insert({
          user_id: userId,
          delta: 0,
          reason: "Suscripción Pro activada",
          reason_key: "pro_activated",
          stripe_ref: session.id,
        });
        break;
      }

      const credits = Number(session.metadata?.credits ?? 0);
      if (credits > 0) {
        const { data: user } = await db()
          .from("omtana_users")
          .select("credits")
          .eq("id", userId)
          .maybeSingle();

        await db()
          .from("omtana_users")
          .update({ credits: (user?.credits ?? 0) + credits })
          .eq("id", userId);
        await db().from("omtana_credit_ledger").insert({
          user_id: userId,
          delta: credits,
          reason: `Compra de ${credits} crédito${credits === 1 ? "" : "s"}`,
          reason_key: "credits_purchased",
          reason_meta: { n: credits },
          stripe_ref: session.id,
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const customerId =
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

      await db().from("omtana_users").update({ plan: "free" }).eq("stripe_customer_id", customerId);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
