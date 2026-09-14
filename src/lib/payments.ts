import "server-only";

/**
 * Si no hay llaves de Stripe no hay nada que cobrar, y entonces tampoco hay
 * tope: la aplicación corre entera como plan Free, sin créditos ni paywall, en
 * vez de empujar a una compra que no se podría completar. Es la única fuente
 * para esa decisión; el resto del código pregunta acá.
 *
 * Vive aparte de `stripe.ts` para que preguntarlo no arrastre el SDK.
 */
export function paymentsEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
