// POST /api/billing/portal — Stripe Customer Portal for managing subscription
import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { getAppOrigin } from "../../../lib/app-url";
import { authenticatedUserEffect } from "../../../lib/auth";
import { Database } from "../../../lib/effect/services/database";
import { Secrets } from "../../../lib/effect/services/secrets";
import { StripeGateway } from "../../../lib/effect/services/stripe";
import { ExternalServiceError, NotFoundError } from "../../../lib/effect/errors";
import { toResponse } from "../../../lib/effect/respond";
import { user } from "../../../lib/schema";

const portalProgram = Effect.fn("billing.portal")(function* (request: Request) {
  const session = yield* authenticatedUserEffect(request);

  const { db } = yield* Database;
  const stripe = yield* StripeGateway;

  const [userRow] = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ stripeCustomerId: user.stripeCustomerId })
        .from(user)
        .where(eq(user.id, session.sub)),
    catch: (cause) => new ExternalServiceError({ service: "d1", cause }),
  });

  if (!userRow?.stripeCustomerId) {
    return yield* new NotFoundError({ resource: "billing account" });
  }
  const customerId = userRow.stripeCustomerId;

  const origin = getAppOrigin(request);
  const url = yield* stripe
    .use((client) =>
      client.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/dashboard`,
      }),
    )
    .pipe(Effect.map((portalSession) => portalSession.url));

  return { url };
});

const appLayer = Layer.merge(
  Database.layer,
  StripeGateway.layer.pipe(Layer.provideMerge(Secrets.layer)),
);

export const Route = createFileRoute("/api/billing/portal")({
  server: {
    handlers: {
      POST: ({ request }) =>
        toResponse(portalProgram(request).pipe(Effect.provide(appLayer)), Response.json),
    },
  },
});
