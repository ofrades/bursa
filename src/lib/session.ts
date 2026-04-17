import { verifySessionToken, type SessionPayload } from './jwt'

export const SESSION_COOKIE = '__session'
const IS_PROD = process.env.NODE_ENV === 'production'

export function makeSessionCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${30 * 24 * 60 * 60}`,
  ]
  if (IS_PROD) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {}
  return Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=')
      return [k.trim(), v.join('=').trim()]
    }),
  )
}

export async function getSessionFromRequest(request: Request): Promise<SessionPayload | null> {
  const cookies = parseCookies(request.headers.get('cookie'))
  const token = cookies[SESSION_COOKIE]
  if (!token) return null
  return verifySessionToken(token)
}
