import { createFileRoute } from '@tanstack/react-router'
import { eq, lt } from 'drizzle-orm'

export const Route = createFileRoute('/api/auth/google/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getDb } = await import('../../../../lib/db')
        const { oauthState, user } = await import('../../../../lib/schema')
        const { createSessionToken } = await import('../../../../lib/jwt')
        const { makeSessionCookie } = await import('../../../../lib/session')
        const db = await getDb()

        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const errorParam = url.searchParams.get('error')

        const fail = (msg: string) =>
          Response.redirect(`/?error=${encodeURIComponent(msg)}`, 302)

        if (errorParam) return fail(errorParam)
        if (!code || !state) return fail('Missing code or state')

        // Look up & consume state
        const [stateRow] = await db
          .select()
          .from(oauthState)
          .where(eq(oauthState.state, state))
          .limit(1)

        if (!stateRow) return fail('Invalid or expired state')
        await db.delete(oauthState).where(eq(oauthState.state, state))

        // Clean up old states (fire and forget)
        const expiry = new Date(Date.now() - 10 * 60 * 1000)
        db.delete(oauthState).where(lt(oauthState.createdAt, expiry)).catch(() => {})

        const clientId = process.env.GOOGLE_CLIENT_ID
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET
        if (!clientId || !clientSecret) return fail('OAuth not configured')

        const origin = process.env.BETTER_AUTH_URL ?? `${url.protocol}//${url.host}`
        const redirectUri = `${origin}/api/auth/google/callback`

        // Exchange code for tokens
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            code_verifier: stateRow.codeVerifier,
          }),
        })

        if (!tokenRes.ok) return fail('Token exchange failed')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tokenData: any = await tokenRes.json()
        const idToken: string = tokenData?.id_token
        if (!idToken) return fail('Missing id_token')

        // Verify token with Google
        const infoRes = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
        )
        if (!infoRes.ok) return fail('Invalid Google token')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info: any = await infoRes.json()

        if (info.aud !== clientId) return fail('Token audience mismatch')
        if (info.email_verified !== 'true' && info.email_verified !== true)
          return fail('Email not verified')

        const email: string = info.email
        const name: string = info.name ?? email
        const image: string | undefined = info.picture

        if (!email) return fail('No email in token')

        // Upsert user
        let [existingUser] = await db
          .select()
          .from(user)
          .where(eq(user.email, email.toLowerCase()))
          .limit(1)

        if (!existingUser) {
          ;[existingUser] = await db
            .insert(user)
            .values({ name, email: email.toLowerCase(), image })
            .returning()
        }

        // Create signed session cookie
        const token = await createSessionToken({
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
          image: existingUser.image,
        })

        return new Response(null, {
          status: 302,
          headers: {
            Location: '/dashboard',
            'Set-Cookie': makeSessionCookie(token),
          },
        })
      },
    },
  },
})
