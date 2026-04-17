import { createFileRoute } from '@tanstack/react-router'

function b64uEncode(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256b64u(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return b64uEncode(digest)
}

function randomString(bytes = 32) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return b64uEncode(arr.buffer)
}

export const Route = createFileRoute('/api/auth/google/start')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getDb } = await import('../../../../lib/db')
        const { oauthState } = await import('../../../../lib/schema')
        const db = await getDb()

        const url = new URL(request.url)
        const clientId = process.env.GOOGLE_CLIENT_ID
        if (!clientId) return new Response('Missing GOOGLE_CLIENT_ID', { status: 500 })

        const state = randomString(16)
        const codeVerifier = randomString(32)
        const codeChallenge = await sha256b64u(codeVerifier)

        await db.insert(oauthState).values({ state, codeVerifier })

        const origin = process.env.BETTER_AUTH_URL ?? `${url.protocol}//${url.host}`
        const redirectUri = `${origin}/api/auth/google/callback`

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        authUrl.searchParams.set('client_id', clientId)
        authUrl.searchParams.set('redirect_uri', redirectUri)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('scope', 'openid email profile')
        authUrl.searchParams.set('state', state)
        authUrl.searchParams.set('code_challenge', codeChallenge)
        authUrl.searchParams.set('code_challenge_method', 'S256')

        return Response.redirect(authUrl.toString(), 302)
      },
    },
  },
})
