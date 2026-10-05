// POST /api/screen/run — admin-only: starts a screen run if none is active,
// otherwise processes the next batch of symbols. Call repeatedly until
// status === "done" (the /screen page's Run button does this for you).
import { Effect } from "effect";
import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";
import { authenticatedUserEffect } from "../../../lib/auth";
import { Database } from "../../../lib/effect/services/database";
import { ExternalServiceError, ValidationError } from "../../../lib/effect/errors";
import { toResponse } from "../../../lib/effect/respond";
import { advanceScreen } from "../../../lib/screen/run";
import { FxCoverageError } from "../../../lib/screen/fx";
import { getSecret } from "../../../secrets";

const runProgram = Effect.fn("screen.run")(function* (request: Request, runId?: string) {
  const session = yield* authenticatedUserEffect(request);
  if (!session.isAdmin) {
    return yield* new ValidationError({ message: "admin only" });
  }
  const { db } = yield* Database;
  return yield* Effect.tryPromise({
    try: () => advanceScreen(db, runId),
    catch: (cause) => new ExternalServiceError({ service: "d1", cause }),
  });
});

export const Route = createFileRoute("/api/screen/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = request.headers.get("content-type")?.includes("application/json")
          ? await request.json().catch(() => null)
          : {};
        const input = z.object({ runId: z.string().uuid().optional() }).safeParse(body);
        if (!input.success)
          return Response.json({ error: "Invalid screen request" }, { status: 400 });
        // Cron/token path: SCREEN_ADMIN_TOKEN holders bypass the session.
        const expected = await getSecret("SCREEN_ADMIN_TOKEN");
        const token = request.headers.get("x-screen-token");
        if (expected && token === expected) {
          const { getDb } = await import("../../../lib/db");
          try {
            const result = await advanceScreen(getDb(), input.data.runId);
            return Response.json(result);
          } catch (cause) {
            if (cause instanceof FxCoverageError)
              return Response.json({ error: cause.message }, { status: 503 });
            throw cause;
          }
        }
        return toResponse(
          runProgram(request, input.data.runId).pipe(Effect.provide(Database.layer)),
          Response.json,
        );
      },
    },
  },
});
