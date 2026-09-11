import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { CREDIT_PACKS, PLAN } from "@/lib/config";

const schema = z.object({
  kind: z.enum(["credits", "pro"]),
  packId: z.string().optional(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Necesitas iniciar sesión." }, { status: 401 });

  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Los pagos todavía no están configurados. Falta STRIPE_SECRET_KEY." },
      { status: 503 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });

  const stripe = getStripe();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;

  // Un customer por usuario, reutilizado entre compras.
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { omtana_user_id: user.id },
    });
    customerId = customer.id;
    await db().from("omtana_users").update({ stripe_customer_id: customerId }).eq("id", user.id);
  }

  const common = {
    customer: customerId,
    success_url: `${origin}/planes?pago=ok`,
    cancel_url: `${origin}/planes?pago=cancelado`,
    client_reference_id: user.id,
  } as const;

  if (parsed.data.kind === "pro") {
    const priceId = process.env.STRIPE_PRICE_PRO;
    if (!priceId) {
      return NextResponse.json({ error: "Falta STRIPE_PRICE_PRO." }, { status: 503 });
    }
    const session = await stripe.checkout.sessions.create({
      ...common,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { omtana_user_id: user.id, kind: "pro", plan_price: PLAN.pro.price },
    });
    return NextResponse.json({ url: session.url });
  }

  const pack = CREDIT_PACKS.find((p) => p.id === parsed.data.packId);
  if (!pack) return NextResponse.json({ error: "Ese pack no existe." }, { status: 400 });

  const session = await stripe.checkout.sessions.create({
    ...common,
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: pack.amountUsd,
          product_data: {
            name: `Omtana · ${pack.qty}`,
            description: "Créditos para generar meditaciones personalizadas. No vencen.",
          },
        },
      },
    ],
    metadata: {
      omtana_user_id: user.id,
      kind: "credits",
      credits: String(pack.credits),
      pack: pack.id,
    },
  });

  return NextResponse.json({ url: session.url });
}
