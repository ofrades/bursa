// POST /api/screen/run — admin-only: starts a screen run if none is active,
// otherwise processes the next batch of symbols. Call repeatedly until
// status === "done" (the /screen page's Run button does this for you).
import { Effect } from "effect";
import { createFileRoute } from "@tanstack/react-router";
import { authenticatedUserEffect } from "../../../lib/auth";
import { Database } from "../../../lib/effect/services/database";
import { ExternalServiceError, ValidationError } from "../../../lib/effect/errors";
import { toResponse } from "../../../lib/effect/respond";
import { advanceScreen } from "../../../lib/screen/run";

const runProgram = Effect.fn("screen.run")(function* (request: Request) {
  const session = yield* authenticatedUserEffect(request);
  if (!session.isAdmin) {
    return yield* new ValidationError({ message: "admin only" });
  }
  const { db } = yield* Database;
  return yield* Effect.tryPromise({
    try: () => advanceScreen(db),
    catch: (cause) => new ExternalServiceError({ service: "d1", cause }),
  });
});

export const Route = createFileRoute("/api/screen/run")({
  server: {
    handlers: {
      POST: ({ request }) =>
        toResponse(runProgram(request).pipe(Effect.provide(Database.layer)), Response.json),
    },
  },
});
