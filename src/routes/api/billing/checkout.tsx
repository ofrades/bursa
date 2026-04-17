// POST /api/billing/checkout — buy a credits pack (one-time payment)
import { createFileRoute } from '@tanstack/react-router'
import { getSessionFromRequest } from '../../../lib/session'

export const Route = createFileRoute('/api/billing/checkout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getSessionFromRequest(request)
        if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

        // Admin bypass never needs billing
        if (session.email.toLowerCase() === 'mig.silva@gmail.com') {
          return Response.json({ url: '/dashboard' })
        }

        const stripeSecret = process.env.STRIPE_SECRET_KEY
        const priceId = process.env.STRIPE_PRICE_CREDITS_10
        if (!stripeSecret || !priceId) {
          return Response.json({ error: 'Stripe not configured' }, { status: 500 })
        }

        const { default: Stripe } = await import('stripe')
        const stripe = new Stripe(stripeSecret, { apiVersion: '2026-03-25.dahlia' })

        const url = new URL(request.url)
        const origin = process.env.BETTER_AUTH_URL ?? `${url.protocol}//${url.host}`

        const { getDb } = await import('../../../lib/db')
        const { user } = await import('../../../lib/schema')
        const { eq } = await import('drizzle-orm')
        const db = await getDb()

        const [userRow] = await db.select().from(user).where(eq(user.id, session.sub))

        let customerId = userRow?.stripeCustomerId ?? undefined
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: session.email,
            name: session.name,
            metadata: { user_id: session.sub },
          })
          customerId = customer.id
          await db.update(user).set({ stripeCustomerId: customerId }).where(eq(user.id, session.sub))
        }

        const checkoutSession = await stripe.checkout.sessions.create({
          mode: 'payment',
          customer: customerId,
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: `${origin}/dashboard?credits=1`,
          cancel_url: `${origin}/dashboard`,
          allow_promotion_codes: true,
          metadata: { user_id: session.sub, credits: '10' },
        })

        return Response.json({ url: checkoutSession.url })
      },
    },
  },
})