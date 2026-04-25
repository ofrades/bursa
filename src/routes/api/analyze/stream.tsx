import { createFileRoute } from "@tanstack/react-router";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { getSessionFromRequest } from "../../../lib/session";
import { gatherStockData, buildPrompt, readMemory, callAIStream } from "../../../server/recommend";
import { calculateCostCents } from "../../../lib/pricing";
import { AI_MODEL } from "../../../lib/ai-model";
const MIN_WALLET_BALANCE_CENTS = 10; // require at least €0.10 to start

// POST /api/analyze/stream
// Streams AI analysis via Server-Sent Events.
// Deducts actual token cost from wallet after stream completes.
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

        const { getDb } = await import("../../../lib/db");
        const { user, usageLog } = await import("../../../lib/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();

        const isAdmin = session.email.toLowerCase() === "mig.silva@gmail.com";

        if (!isAdmin) {
          const [u] = await db
            .select({ walletBalance: user.walletBalance })
            .from(user)
            .where(eq(user.id, session.sub));
          if ((u?.walletBalance ?? 0) < MIN_WALLET_BALANCE_CENTS) {
            return new Response("INSUFFICIENT_FUNDS", { status: 402 });
          }
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
            let accumulatedText = "";
            let usage: {
              promptTokens: number;
              completionTokens: number;
              totalTokens: number;
            } | null = null;

            try {
              for await (const chunk of callAIStream(prompt)) {
                if (chunk.type === "delta") {
                  accumulatedText += chunk.delta;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ delta: chunk.delta })}

`),
                  );
                }
                if (chunk.type === "usage") {
                  usage = chunk.usage;
                }
              }

              // Calculate and deduct cost
              if (!isAdmin && usage) {
                const costCents = calculateCostCents(
                  AI_MODEL,
                  usage.promptTokens,
                  usage.completionTokens,
                );

                const [u] = await db
                  .select({ walletBalance: user.walletBalance })
                  .from(user)
                  .where(eq(user.id, session.sub));

                const newBalance = Math.max(0, (u?.walletBalance ?? 0) - costCents);
                await db
                  .update(user)
                  .set({ walletBalance: newBalance })
                  .where(eq(user.id, session.sub));

                await db.insert(usageLog).values({
                  userId: session.sub,
                  symbol,
                  model: AI_MODEL,
                  promptTokens: usage.promptTokens,
                  completionTokens: usage.completionTokens,
                  totalTokens: usage.totalTokens,
                  costCents,
                  createdAt: new Date(),
                });

                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ done: true, costCents })}

`),
                );
              } else {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ done: true })}

`),
                );
              }

              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            } catch (err) {
              const message = err instanceof Error ? err.message : "Stream error";
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ error: message })}

`),
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
