import { createFileRoute } from "@tanstack/react-router";
import { runTask } from "nitro/task";

// POST /api/cron/run?task=stocks:weekly&secret=xxx
// Protected by CRON_SECRET env var — call from system cron or CI
export const Route = createFileRoute("/api/cron/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const secret = url.searchParams.get("secret");
        const taskName = url.searchParams.get("task") ?? "stocks:weekly";

        if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const allowed = ["stocks:weekly", "stocks:check"];
        if (!allowed.includes(taskName)) {
          return Response.json({ error: "Unknown task" }, { status: 400 });
        }

        try {
          const result = await runTask(taskName);
          return Response.json({ ok: true, task: taskName, result });
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
