import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getSessionFromRequest } from "../lib/session";

export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await getSessionFromRequest(getRequest());
  if (!session)
    return next({ context: { session: null, analysisCredits: 0, isAdmin: false } as any });

  // Ensure user exists in DB — handles stale JWTs after a DB reset
  const { getDb } = await import("../lib/db");
  const { user } = await import("../lib/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();

  const [existing] = await db
    .select({ analysisCredits: user.analysisCredits })
    .from(user)
    .where(eq(user.id, session.sub));

  const isAdmin = session.email.toLowerCase() === "mig.silva@gmail.com";

  if (!existing) {
    await db
      .insert(user)
      .values({
        id: session.sub,
        email: session.email,
        name: session.name,
        image: session.image ?? null,
        analysisCredits: isAdmin ? 999999 : 0,
      })
      .onConflictDoNothing();
  }

  return next({
    context: {
      session,
      analysisCredits: isAdmin ? 999999 : (existing?.analysisCredits ?? 0),
      isAdmin,
    } as any,
  });
});
