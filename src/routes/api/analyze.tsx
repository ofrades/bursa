import { Effect, Layer } from "effect";
import { createFileRoute } from "@tanstack/react-router";
import { Database } from "../../lib/effect/services/database";
import { Secrets } from "../../lib/effect/services/secrets";
import { toResponse } from "../../lib/effect/respond";
import { analyzeProgram } from "../../server/analyze";

export const Route = createFileRoute("/api/analyze")({
  server: {
    handlers: {
      POST: ({ request }) =>
        toResponse(
          analyzeProgram(request).pipe(Effect.provide(Layer.merge(Database.layer, Secrets.layer))),
          (response) => response,
        ),
    },
  },
});
