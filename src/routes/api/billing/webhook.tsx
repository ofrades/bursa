import { Cause, Effect, Exit, Layer } from "effect";
import { createFileRoute } from "@tanstack/react-router";
import type StripeType from "stripe";
import { Database } from "../../../lib/effect/services/database";
import { Secrets } from "../../../lib/effect/services/secrets";
import { StripeGateway } from "../../../lib/effect/services/stripe";
import { applyWalletTopUpEffect } from "../../../lib/wallet-topup";
import { paidEuroAmount } from "../../../lib/stripe-payment";

const webhookProgram = Effect.fn("billing.webhook")(function* (request: Request) {
  const secrets = yield* Secrets;
  const webhookSecret = yield* secrets.getOrThrow("STRIPE_WEBHOOK_SECRET");
  const stripe = yield* StripeGateway;

  const payload = yield* Effect.promise(() => request.text());
  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return new Response("Missing signature", { status: 400 });
  }

  // Async variant required on Workers — sync verification relies on
  // the Node crypto subsystem, which workerd does not provide.
  const verified = yield* Effect.exit(
    stripe.use((client) => client.webhooks.constructEventAsync(payload, sig, webhookSecret)),
  );

  if (Exit.isFailure(verified)) {
    return new Response(`Webhook Error: ${Cause.squash(verified.cause)}`, {
      status: 400,
    });
  }
  const event: StripeType.Event = verified.value;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as StripeType.Checkout.Session;
    const userId = session.metadata?.user_id;

    if (!userId) {
      return new Response("Not credited: missing user metadata", { status: 200 });
    }

    const { db } = yield* Database;

    const centsToAdd = paidEuroAmount(session);
    if (centsToAdd === null) {
      // Validly signed but permanently non-creditable events receive a
      // 2xx so Stripe does not retry them indefinitely.
      return new Response("Not credited: invalid payment details", { status: 200 });
    }

    const result = yield* applyWalletTopUpEffect(db, {
      userId,
      checkoutSessionId: session.id,
      stripeEventId: event.id,
      centsToAdd,
    }).pipe(
      Effect.catchTag("NotFoundError", () =>
        Effect.succeed(new Response("Not credited: user not found", { status: 200 })),
      ),
    );

    if (result instanceof Response) return result;
    if (result.status === "duplicate") {
      return new Response("Already processed", { status: 200 });
    }
  }

  return new Response("OK", { status: 200 });
});

const appLayer = Layer.merge(
  Database.layer,
  StripeGateway.layer.pipe(Layer.provideMerge(Secrets.layer)),
);

// POST /api/billing/webhook — Stripe webhook endpoint
// Handles checkout.session.completed to top up user wallet.
export const Route = createFileRoute("/api/billing/webhook")({
  server: {
    handlers: {
      POST: ({ request }) =>
        Effect.runPromise(webhookProgram(request).pipe(Effect.provide(appLayer))).then(
          (response) => response as Response,
        ),
    },
  },
});
