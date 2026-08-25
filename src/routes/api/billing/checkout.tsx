// POST /api/billing/checkout — top up wallet with any amount
import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { getAppOrigin } from "../../../lib/app-url";
import { authenticatedUserEffect } from "../../../lib/auth";
import { Database } from "../../../lib/effect/services/database";
import { Secrets } from "../../../lib/effect/services/secrets";
import { StripeGateway } from "../../../lib/effect/services/stripe";
import { ValidationError, ExternalServiceError } from "../../../lib/effect/errors";
import { toResponse } from "../../../lib/effect/respond";
import { user } from "../../../lib/schema";

const checkoutProgram = Effect.fn("billing.checkout")(function* (request: Request) {
  const session = yield* authenticatedUserEffect(request);

  // Admin bypass never needs billing
  if (session.isAdmin) {
    return { url: "/" };
  }

  const body = (yield* Effect.promise(() => request.json().catch(() => ({})))) as {
    amountEur?: number;
  };
  const amountEur = Math.max(1, Math.min(100, Math.round(body.amountEur ?? 1)));
  if (!Number.isFinite(amountEur)) {
    return yield* new ValidationError({ message: "invalid amountEur" });
  }
  const cents = amountEur * 100;

  const { db } = yield* Database;
  const stripe = yield* StripeGateway;

  const [userRow] = yield* Effect.tryPromise({
    try: () => db.select().from(user).where(eq(user.id, session.sub)),
    catch: (cause) => new ExternalServiceError({ service: "d1", cause }),
  });

  let customerId = userRow?.stripeCustomerId ?? undefined;
  if (!customerId) {
    customerId = yield* stripe
      .use((client) =>
        client.customers.create({
          email: session.email,
          name: session.name,
          metadata: { user_id: session.sub },
        }),
      )
      .pipe(Effect.map((customer) => customer.id));

    yield* Effect.tryPromise({
      try: () =>
        db.update(user).set({ stripeCustomerId: customerId }).where(eq(user.id, session.sub)),
      catch: (cause) => new ExternalServiceError({ service: "d1", cause }),
    }).pipe(Effect.orDie);
  }

  const origin = getAppOrigin(request);
  const url = yield* stripe
    .use((client) =>
      client.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: "eur",
              unit_amount: cents,
              product_data: {
                name: "Wallet Top-up",
                description: `Add €${amountEur.toFixed(2)} to your Bursa wallet`,
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${origin}/?topup=1`,
        cancel_url: `${origin}/`,
        // Wallet value must match the amount Stripe reports as paid. Keep
        // promotions disabled so checkout cannot fall below the €1 minimum.
        allow_promotion_codes: false,
        metadata: { user_id: session.sub },
      }),
    )
    .pipe(Effect.map((checkoutSession) => checkoutSession.url ?? "/"));

  return { url };
});

const appLayer = Layer.merge(
  Database.layer,
  StripeGateway.layer.pipe(Layer.provideMerge(Secrets.layer)),
);

export const Route = createFileRoute("/api/billing/checkout")({
  server: {
    handlers: {
      POST: ({ request }) =>
        toResponse(checkoutProgram(request).pipe(Effect.provide(appLayer)), Response.json),
    },
  },
});
