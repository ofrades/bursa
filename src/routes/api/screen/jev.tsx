// POST /api/screen/jev — admin-only (or x-screen-token): run the revision-
// quality classifier over the latest completed screen run's strict quintile.
// Pass { all: true } to classify every survivor.
import { Effect } from "effect";
import { createFileRoute } from "@tanstack/react-router";
import { authenticatedUserEffect } from "../../../lib/auth";
import { Database } from "../../../lib/effect/services/database";
import { ExternalServiceError, ValidationError } from "../../../lib/effect/errors";
import { toResponse } from "../../../lib/effect/respond";
import { classifyLatestRun } from "../../../lib/screen/jev";
import { getSecret } from "../../../secrets";

const jevProgram = Effect.fn("screen.jev")(function* (request: Request) {
  const session = yield* authenticatedUserEffect(request);
  if (!session.isAdmin) {
    return yield* new ValidationError({ message: "admin only" });
  }
  const body = (yield* Effect.promise(() => request.json().catch(() => ({})))) as {
    all?: boolean;
  };
  const { db } = yield* Database;
  return yield* Effect.tryPromise({
    try: () => classifyLatestRun(db, { all: body.all === true }),
    catch: (cause) => new ExternalServiceError({ service: "openrouter", cause }),
  });
});

export const Route = createFileRoute("/api/screen/jev")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Cron/token path: SCREEN_ADMIN_TOKEN holders bypass the session.
        const expected = await getSecret("SCREEN_ADMIN_TOKEN");
        const token = request.headers.get("x-screen-token");
        if (expected && token === expected) {
          const body = (await request.json().catch(() => ({}))) as { all?: boolean };
          const { getDb } = await import("../../../lib/db");
          const result = await classifyLatestRun(getDb(), { all: body.all === true });
          return Response.json(result);
        }
        return toResponse(jevProgram(request).pipe(Effect.provide(Database.layer)), Response.json);
      },
    },
  },
});
