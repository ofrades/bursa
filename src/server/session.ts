import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getSessionFromRequest } from '../lib/session'
import type { SessionPayload } from '../lib/jwt'

export const getSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<(SessionPayload & { analysisCredits: number; isAdmin: boolean }) | null> => {
    const session = await getSessionFromRequest(getRequest())
    if (!session) return null

    const { getDb } = await import('../lib/db')
    const { user } = await import('../lib/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()

    const isAdmin = session.email.toLowerCase() === 'mig.silva@gmail.com'
    const [row] = await db.select({ analysisCredits: user.analysisCredits })
      .from(user).where(eq(user.id, session.sub))

    return { ...session, analysisCredits: isAdmin ? 999999 : (row?.analysisCredits ?? 0), isAdmin }
  },
)
