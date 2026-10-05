// POST /api/screen/outcomes — admin-only (or x-screen-token): record forward
// returns for the latest completed screen run's survivors. Idempotent; each
// call extends the horizons whose windows have elapsed. Call from cron daily.
import { Effect } from "effect";
import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";
import { authenticatedUserEffect } from "../../../lib/auth";
import { Database } from "../../../lib/effect/services/database";
import { ExternalServiceError, ValidationError } from "../../../lib/effect/errors";
import { toResponse } from "../../../lib/effect/respond";
import { recordOutcomes } from "../../../lib/screen/outcomes";
import { getSecret } from "../../../secrets";

const bodySchema = z.object({ runId: z.string().uuid().optional() });

const outcomesProgram = Effect.fn("screen.outcomes")(function* (request: Request, runId?: string) {
  const session = yield* authenticatedUserEffect(request);
  if (!session.isAdmin) {
    return yield* new ValidationError({ message: "admin only" });
  }
  const { db } = yield* Database;
  return yield* Effect.tryPromise({
    try: () => recordOutcomes(db, runId),
    catch: (cause) => new ExternalServiceError({ service: "d1", cause }),
  });
});

export const Route = createFileRoute("/api/screen/outcomes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = request.headers.get("content-type")?.includes("application/json")
          ? await request.json().catch(() => null)
          : {};
        const input = bodySchema.safeParse(body);
        if (!input.success) {
          return Response.json({ error: "Invalid screen request" }, { status: 400 });
        }
        const expected = await getSecret("SCREEN_ADMIN_TOKEN");
        const token = request.headers.get("x-screen-token");
        if (expected && token === expected) {
          const { getDb } = await import("../../../lib/db");
          const result = await recordOutcomes(getDb(), input.data.runId);
          return Response.json(result);
        }
        return toResponse(
          outcomesProgram(request, input.data.runId).pipe(Effect.provide(Database.layer)),
          Response.json,
        );
      },
    },
  },
});
