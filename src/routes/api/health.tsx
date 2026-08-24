import { sql } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";

// Health check for load balancer probes: verifies the app can reach D1.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { getDb } = await import("../../lib/db");
          await getDb().run(sql`SELECT 1 AS ok`);
          return Response.json({ status: "ok", ts: Date.now(), db: "ok" });
        } catch (error) {
          return Response.json(
            {
              status: "degraded",
              ts: Date.now(),
              db: error instanceof Error ? error.message : "error",
            },
            { status: 503 },
          );
        }
      },
    },
  },
});
