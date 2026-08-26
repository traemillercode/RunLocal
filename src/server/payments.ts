import Stripe from "stripe";
import type { Db } from "./store";
import type { AdminCtx } from "./admin";
import { authorizeAdmin, type AdminResult } from "./admin";

/**
 * Payments for sponsor placements go through Stripe Checkout, which handles
 * Apple Pay automatically (no separate integration needed — Stripe detects
 * the browser/device and offers it as a payment method on its own hosted
 * page). Payouts land in whatever bank account is connected in the Stripe
 * dashboard — that's configured on Stripe's side, not here.
 *
 * Sponsorships are sold manually (a real sales conversation, not a
 * self-serve ad platform): the owner sets the price and generates a
 * one-time payment link to send to the business, rather than a public
 * checkout page anyone can land on.
 */

const STRIPE_KEY_VAR = "STRIPE_SECRET_KEY";
const STRIPE_WEBHOOK_SECRET_VAR = "STRIPE_WEBHOOK_SECRET";

export function stripeConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env[STRIPE_KEY_VAR]);
}

let cachedClient: Stripe | null = null;
function stripeClient(env: Record<string, string | undefined> = process.env): Stripe | null {
  const key = env[STRIPE_KEY_VAR];
  if (!key) return null;
  if (!cachedClient) cachedClient = new Stripe(key);
  return cachedClient;
}

/** Reasonable starter pricing — easy to change here without touching the checkout flow itself. */
export const SPONSOR_PRICING_USD = { featured: 250, standard: 100 } as const;

interface CheckoutInput {
  sponsorId?: unknown;
  successUrl?: unknown;
  cancelUrl?: unknown;
}

/**
 * Creates a one-time Stripe Checkout session for a sponsor placement that
 * already exists as an inactive record (created via the normal sponsor form
 * with active:false) — the checkout just references it by id in metadata.
 * On successful payment, the webhook flips that same record active using
 * the existing cap-enforcing updateSponsor, rather than duplicating record
 * creation here. Returns the hosted checkout URL to send to the business —
 * they pay by card or Apple Pay on Stripe's own page, nothing custom-built.
 */
export async function createSponsorCheckout(db: Db, ctx: AdminCtx, input: CheckoutInput, now = new Date()): Promise<AdminResult<{ url: string }>> {
  const auth = authorizeAdmin(db, ctx, "admin.sponsor_create", null, now);
  if (!auth.ok) return auth;
  const stripe = stripeClient();
  if (!stripe) return { ok: false, status: 503, error: "stripe_unconfigured", message: "Add STRIPE_SECRET_KEY on Railway to enable payment links." };
  const sponsorId = typeof input.sponsorId === "string" ? input.sponsorId : "";
  const sponsor = sponsorId ? db.getSponsor(sponsorId) : undefined;
  if (!sponsor) return { ok: false, status: 404, error: "not_found", message: "Create the sponsor placement first, then generate its payment link." };
  const successUrl = typeof input.successUrl === "string" && input.successUrl ? input.successUrl : "https://getkimbio.com/";
  const cancelUrl = typeof input.cancelUrl === "string" && input.cancelUrl ? input.cancelUrl : "https://getkimbio.com/";
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: SPONSOR_PRICING_USD[sponsor.tier] * 100,
            product_data: { name: `Kimbio ${sponsor.tier === "featured" ? "Featured" : "Standard"} sponsor placement — ${sponsor.businessName}` },
          },
        },
      ],
      metadata: { kind: "sponsor_placement", sponsorId: sponsor.id },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    if (!session.url) return { ok: false, status: 502, error: "stripe_error", message: "Stripe didn't return a checkout URL — try again." };
    return { ok: true, data: { url: session.url } };
  } catch (e) {
    return { ok: false, status: 502, error: "stripe_error", message: e instanceof Error ? e.message : "Stripe request failed." };
  }
}

/**
 * Verifies and handles a Stripe webhook event. Signature verification uses
 * STRIPE_WEBHOOK_SECRET — never trusts an unsigned payload, since this
 * endpoint has no other auth and directly creates paid placements.
 */
export function handleStripeWebhook(rawBody: Buffer, signature: string | undefined, env: Record<string, string | undefined> = process.env): { ok: true; event: Stripe.Event } | { ok: false; status: number; error: string } {
  const stripe = stripeClient(env);
  const webhookSecret = env[STRIPE_WEBHOOK_SECRET_VAR];
  if (!stripe || !webhookSecret) return { ok: false, status: 503, error: "stripe_unconfigured" };
  if (!signature) return { ok: false, status: 400, error: "missing_signature" };
  try {
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    return { ok: true, event };
  } catch {
    return { ok: false, status: 400, error: "invalid_signature" };
  }
}

/**
 * Activates the sponsor referenced in a paid checkout session's metadata.
 * Runs after signature verification, so this is the one place a sponsor
 * gets flipped active from a payment — never from a client-editable field.
 */
export function activateSponsorFromEvent(db: Db, event: Stripe.Event): void {
  if (event.type !== "checkout.session.completed") return;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.kind !== "sponsor_placement") return;
  const sponsorId = session.metadata.sponsorId;
  if (!sponsorId) return;
  db.updateSponsor(sponsorId, { active: true });
}
