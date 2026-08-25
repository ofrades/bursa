import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { Database } from "./effect/services/database";
import { UnauthorizedError, ExternalServiceError } from "./effect/errors";
import { getSessionFromRequest, type SessionPayload } from "./session";
import { user } from "./schema";

export type AuthenticatedUser = {
  sub: string;
  email: string;
  name: string;
  image: string | null;
  walletBalance: number;
  isAdmin: boolean;
  sessionVersion: number;
};

const loadUser = Effect.fn("Auth.loadUser")(function* (session: SessionPayload) {
  const { db } = yield* Database;
  const [row] = yield* Effect.tryPromise({
    try: () =>
      db
        .select({
          email: user.email,
          name: user.name,
          image: user.image,
          walletBalance: user.walletBalance,
          role: user.role,
          sessionVersion: user.sessionVersion,
        })
        .from(user)
        .where(eq(user.id, session.sub))
        .limit(1),
    catch: (cause) => new ExternalServiceError({ service: "d1", cause }),
  });

  if (!row || row.sessionVersion !== session.ver) return null;
  const isAdmin = row.role === "admin";
  return {
    sub: session.sub,
    email: row.email,
    name: row.name,
    image: row.image,
    walletBalance: isAdmin ? 999_999_00 : row.walletBalance,
    isAdmin,
    sessionVersion: row.sessionVersion,
  } satisfies AuthenticatedUser;
});

/**
 * Resolves the authenticated user for a request as an Effect.
 * Fails with UnauthorizedError when there is no valid session or the
 * session version has been revoked.
 */
export const authenticatedUserEffect = (
  request: Request,
): Effect.Effect<AuthenticatedUser, UnauthorizedError | ExternalServiceError, Database> =>
  Effect.gen(function* () {
    const session = yield* Effect.promise(() => getSessionFromRequest(request));
    if (!session) return yield* new UnauthorizedError();
    const found = yield* loadUser(session);
    if (!found) return yield* new UnauthorizedError();
    return found;
  });

/** Promise-based facade for non-Effect call sites. */
export async function getAuthenticatedUser(request: Request): Promise<AuthenticatedUser | null> {
  return Effect.runPromise(
    authenticatedUserEffect(request).pipe(
      Effect.catchTags({
        UnauthorizedError: () => Effect.succeed(null),
        ExternalServiceError: () => Effect.succeed(null),
      }),
      Effect.provide(Database.layer),
    ),
  );
}
