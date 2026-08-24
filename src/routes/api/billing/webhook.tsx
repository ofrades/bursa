import { createFileRoute } from "@tanstack/react-router";
import type StripeType from "stripe";
import { getSecret } from "../../../secrets";
import { getDb } from "../../../lib/db";
import { applyWalletTopUp } from "../../../lib/wallet-topup";
import { paidEuroAmount } from "../../../lib/stripe-payment";

// POST /api/billing/webhook — Stripe webhook endpoint
// Handles checkout.session.completed to top up user wallet.
export const Route = createFileRoute("/api/billing/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [stripeSecret, webhookSecret] = await Promise.all([
          getSecret("STRIPE_SECRET_KEY"),
          getSecret("STRIPE_WEBHOOK_SECRET"),
        ]);
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
          // Async variant required on Workers — sync verification relies on
          // the Node crypto subsystem, which workerd does not provide.
          event = await stripe.webhooks.constructEventAsync(payload, sig, webhookSecret);
        } catch (err: any) {
          return new Response(`Webhook Error: ${err.message}`, { status: 400 });
        }

        if (event.type === "checkout.session.completed") {
          const session = event.data.object as StripeType.Checkout.Session;
          const userId = session.metadata?.user_id;

          if (!userId) {
            return new Response("Not credited: missing user metadata", { status: 200 });
          }

          const db = await getDb();

          const centsToAdd = paidEuroAmount(session);
          if (centsToAdd === null) {
            // Validly signed but permanently non-creditable events receive a
            // 2xx so Stripe does not retry them indefinitely.
            return new Response("Not credited: invalid payment details", { status: 200 });
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
              return new Response("Not credited: user not found", { status: 200 });
            }
            throw error;
          }
        }

        return new Response("OK", { status: 200 });
      },
    },
  },
});
