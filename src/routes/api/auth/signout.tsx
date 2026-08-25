import { Effect } from "effect";
import { eq, sql } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { clearSessionCookie } from "../../../lib/session";
import { authenticatedUserEffect } from "../../../lib/auth";
import { Database, query } from "../../../lib/effect/services/database";
import { user } from "../../../lib/schema";

const signoutProgram = Effect.fn("auth.signout")(function* (request: Request) {
  const maybeSession = yield* authenticatedUserEffect(request).pipe(
    Effect.catch(() => Effect.succeed(null)),
  );

  if (maybeSession) {
    yield* query((database) =>
      database
        .update(user)
        .set({ sessionVersion: sql`${user.sessionVersion} + 1` })
        .where(eq(user.id, maybeSession.sub))
        .then(() => undefined),
    ).pipe(Effect.orDie);
  }

  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": clearSessionCookie() },
  });
});

export const Route = createFileRoute("/api/auth/signout")({
  server: {
    handlers: {
      POST: ({ request }) =>
        Effect.runPromise(signoutProgram(request).pipe(Effect.provide(Database.layer))),
    },
  },
});
