// POST /api/billing/portal — Stripe Customer Portal for managing subscription
import { createFileRoute } from "@tanstack/react-router";
import { getSessionFromRequest } from "../../../lib/session";

export const Route = createFileRoute("/api/billing/portal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getSessionFromRequest(request);
        if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const stripeSecret = process.env.STRIPE_SECRET_KEY;
        if (!stripeSecret)
          return Response.json({ error: "Stripe not configured" }, { status: 500 });

        const { getDb } = await import("../../../lib/db");
        const { user } = await import("../../../lib/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();

        const [userRow] = await db
          .select({ stripeCustomerId: user.stripeCustomerId })
          .from(user)
          .where(eq(user.id, session.sub));

        if (!userRow?.stripeCustomerId) {
          return Response.json({ error: "No billing account found" }, { status: 404 });
        }

        const { default: Stripe } = await import("stripe");
        const stripe = new Stripe(stripeSecret, { apiVersion: "2026-04-22.preview" });

        const url = new URL(request.url);
        const origin = process.env.BETTER_AUTH_URL ?? `${url.protocol}//${url.host}`;

        const portalSession = await stripe.billingPortal.sessions.create({
          customer: userRow.stripeCustomerId,
          return_url: `${origin}/dashboard`,
        });

        return Response.json({ url: portalSession.url });
      },
    },
  },
});
