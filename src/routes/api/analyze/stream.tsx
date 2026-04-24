import { createFileRoute } from "@tanstack/react-router";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { getSessionFromRequest } from "../../../lib/session";
import { gatherStockData, buildPrompt, readMemory, callAIStream } from "../../../server/recommend";

// POST /api/analyze/stream
// Streams AI analysis via Server-Sent Events
export const Route = createFileRoute("/api/analyze/stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getSessionFromRequest(request);
        if (!session) {
          return new Response("Unauthorized", { status: 401 });
        }

        const body = (await request.json().catch(() => ({}))) as {
          symbol?: string;
        };
        const symbol = body.symbol?.toUpperCase();
        if (!symbol) {
          return new Response("Missing symbol", { status: 400 });
        }

        // Credit check
        const isAdmin = session.email.toLowerCase() === "mig.silva@gmail.com";
        if (!isAdmin) {
          const { getDb } = await import("../../../lib/db");
          const { user } = await import("../../../lib/schema");
          const { eq } = await import("drizzle-orm");
          const db = await getDb();
          const [u] = await db
            .select({ analysisCredits: user.analysisCredits })
            .from(user)
            .where(eq(user.id, session.sub));
          if ((u?.analysisCredits ?? 0) < 1) {
            return new Response("CREDITS_REQUIRED", { status: 402 });
          }
          // Deduct credit immediately
          await db
            .update(user)
            .set({ analysisCredits: Math.max(0, (u?.analysisCredits ?? 0) - 1) })
            .where(eq(user.id, session.sub));
        }

        const today = new Date();
        const weekStart = format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");
        const weekEnd = format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");

        const [stockData, memory] = await Promise.all([
          gatherStockData(symbol),
          readMemory(symbol),
        ]);

        const setupContext = [
          `Daily 21 EMA: $${stockData.ema21Daily?.toFixed(2) ?? "N/A"} (${stockData.priceVsEMA21?.toFixed(1) ?? "N/A"}% vs price)`,
          `Weekly 21 EMA: $${stockData.weeklyEma21?.toFixed(2) ?? "N/A"} (${stockData.priceVsWeeklyEMA21?.toFixed(1) ?? "N/A"}% vs price)`,
          `Volume trend: ${stockData.volumeTrend?.toFixed(1) ?? "N/A"}%`,
        ].join(" | ");

        const prompt = buildPrompt(stockData, memory, setupContext, false, weekStart, weekEnd);

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const delta of callAIStream(prompt)) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ delta })}

`),
                );
              }
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            } catch (err) {
              const message = err instanceof Error ? err.message : "Stream error";
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ error: message })}

`,
                ),
              );
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
