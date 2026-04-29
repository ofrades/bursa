import { createFileRoute } from "@tanstack/react-router";
import type StripeType from "stripe";
import { getDb } from "../../../lib/db";
import { applyWalletTopUp } from "../../../lib/wallet-topup";

// POST /api/billing/webhook — Stripe webhook endpoint
// Handles checkout.session.completed to top up user wallet.
export const Route = createFileRoute("/api/billing/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const stripeSecret = process.env.STRIPE_SECRET_KEY;
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!stripeSecret || !webhookSecret) {
          return new Response("Stripe not configured", { status: 500 });
        }

        const { default: Stripe } = await import("stripe");
        const stripe = new Stripe(stripeSecret, { apiVersion: "2026-04-22.preview" });

        const payload = await request.text();
        const sig = request.headers.get("stripe-signature");
        if (!sig) {
          return new Response("Missing signature", { status: 400 });
        }

        let event: StripeType.Event;
        try {
          event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
        } catch (err: any) {
          return new Response(`Webhook Error: ${err.message}`, { status: 400 });
        }

        if (event.type === "checkout.session.completed") {
          const session = event.data.object as StripeType.Checkout.Session;
          const userId = session.metadata?.user_id;
          const creditsRaw = session.metadata?.credits; // legacy
          const amountRaw = session.metadata?.amount_eur; // e.g. "5"

          if (!userId) {
            return new Response("Missing user_id in metadata", { status: 400 });
          }

          const db = await getDb();

          // Determine how many cents to add
          // Prefer explicit amount_eur, fall back to legacy credits pack (€1 = 10 credits)
          const eurAmount = amountRaw ? parseFloat(amountRaw) : creditsRaw ? 1 : 0;
          const centsToAdd = Math.round(eurAmount * 100);

          if (centsToAdd <= 0) {
            return new Response("Nothing to add", { status: 200 });
          }

          try {
            const result = await applyWalletTopUp(db, {
              userId,
              checkoutSessionId: session.id,
              stripeEventId: event.id,
              centsToAdd,
            });

            if (result.status === "duplicate") {
              return new Response("Already processed", { status: 200 });
            }
          } catch (error) {
            if (error instanceof Error && error.message === "User not found") {
              return new Response("User not found", { status: 404 });
            }
            throw error;
          }
        }

        return new Response("OK", { status: 200 });
      },
    },
  },
});
