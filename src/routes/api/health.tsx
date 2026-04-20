import { createFileRoute } from "@tanstack/react-router";

// Simple health check endpoint for Kamal / load balancer probes
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => Response.json({ status: "ok", ts: Date.now() }),
    },
  },
});
