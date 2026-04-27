import { randomUUID } from "crypto";
import { toServerSentEventsResponse, type StreamChunk } from "@tanstack/ai";
import { createFileRoute } from "@tanstack/react-router";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { AI_MODEL } from "../../../lib/ai-model";
import { getSessionFromRequest } from "../../../lib/session";
import {
  AIRequestAbortedError,
  gatherStockData,
  buildPrompt,
  readMemory,
  callAIStream,
  chargeUserForUsage,
  type AIUsage,
} from "../../../server/recommend";

const MIN_WALLET_BALANCE_CENTS = 10; // require at least €0.10 to start
const STREAM_HEARTBEAT_MS = 15_000;

// POST /api/analyze/stream
// Streams AI analysis via Server-Sent Events.
// Deducts the billed wallet amount from OpenRouter's actual reported request cost.
export const Route = createFileRoute("/api/analyze/stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getSessionFromRequest(request);
        if (!session) {
          return new Response("Unauthorized", { status: 401 });
        }
        const sessionSub = session.sub;
        const sessionEmail = session.email.toLowerCase();

        const body = (await request.json().catch(() => ({}))) as {
          symbol?: string;
        };
        const symbol = body.symbol?.toUpperCase();
        if (!symbol) {
          return new Response("Missing symbol", { status: 400 });
        }
        const analysisSymbol = symbol;

        const { getDb } = await import("../../../lib/db");
        const { user } = await import("../../../lib/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();

        const isAdmin = sessionEmail === "mig.silva@gmail.com";

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
          gatherStockData(analysisSymbol),
          readMemory(analysisSymbol),
        ]);

        const setupContext = [
          `Daily 21 EMA: $${stockData.ema21Daily?.toFixed(2) ?? "N/A"} (${stockData.priceVsEMA21?.toFixed(1) ?? "N/A"}% vs price)`,
          `Weekly 21 EMA: $${stockData.weeklyEma21?.toFixed(2) ?? "N/A"} (${stockData.priceVsWeeklyEMA21?.toFixed(1) ?? "N/A"}% vs price)`,
          `Volume trend: ${stockData.volumeTrend?.toFixed(1) ?? "N/A"}%`,
        ].join(" | ");

        const prompt = buildPrompt(stockData, memory, setupContext, false, weekStart, weekEnd);

        const abortController = new AbortController();
        request.signal.addEventListener(
          "abort",
          () => abortController.abort(request.signal.reason),
          { once: true },
        );

        async function* createAnalysisStream(): AsyncIterable<StreamChunk> {
          const runId = randomUUID();
          const messageId = randomUUID();
          let usage: AIUsage | null = null;
          let startedTextMessage = false;
          let partialWarning: string | null = null;

          yield {
            type: "RUN_STARTED",
            runId,
            model: AI_MODEL,
            timestamp: Date.now(),
          };

          try {
            const iterator = callAIStream(prompt, { signal: abortController.signal })[
              Symbol.asyncIterator
            ]();
            let nextChunk = iterator.next();

            while (!abortController.signal.aborted) {
              let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
              const heartbeat = new Promise<{ kind: "heartbeat" }>((resolve) => {
                heartbeatTimer = setTimeout(
                  () => resolve({ kind: "heartbeat" }),
                  STREAM_HEARTBEAT_MS,
                );
              });

              const result = await Promise.race([
                nextChunk.then((value) => ({ kind: "chunk" as const, value })),
                heartbeat,
              ]);

              if (heartbeatTimer) {
                clearTimeout(heartbeatTimer);
              }

              if (result.kind === "heartbeat") {
                yield {
                  type: "CUSTOM",
                  name: "heartbeat",
                  model: AI_MODEL,
                  timestamp: Date.now(),
                };
                continue;
              }

              if (result.value.done) {
                break;
              }

              const chunk = result.value.value;
              nextChunk = iterator.next();

              if (chunk.type === "delta") {
                if (!startedTextMessage) {
                  startedTextMessage = true;
                  yield {
                    type: "TEXT_MESSAGE_START",
                    messageId,
                    role: "assistant",
                    model: AI_MODEL,
                    timestamp: Date.now(),
                  };
                }

                yield {
                  type: "TEXT_MESSAGE_CONTENT",
                  messageId,
                  delta: chunk.delta,
                  model: AI_MODEL,
                  timestamp: Date.now(),
                };
                continue;
              }

              if (chunk.type === "warning") {
                partialWarning = chunk.warning;
                continue;
              }

              usage = chunk.usage;
            }

            if (startedTextMessage) {
              yield {
                type: "TEXT_MESSAGE_END",
                messageId,
                model: usage?.model ?? AI_MODEL,
                timestamp: Date.now(),
              };
            }

            let billedCents: number | null = null;
            if (!isAdmin && usage) {
              const billing = await chargeUserForUsage(db, sessionSub, analysisSymbol, usage);
              billedCents = billing.billedCents;
            }

            if (usage) {
              yield {
                type: "CUSTOM",
                name: "openrouter-usage",
                model: usage.model,
                timestamp: Date.now(),
                value: {
                  ...usage,
                  billedCents,
                },
              };
            }

            if (partialWarning) {
              yield {
                type: "CUSTOM",
                name: "analysis-warning",
                model: AI_MODEL,
                timestamp: Date.now(),
                value: {
                  message: partialWarning,
                  kind: "partial-output",
                },
              };
            }

            yield {
              type: "RUN_FINISHED",
              runId,
              model: usage?.model ?? AI_MODEL,
              timestamp: Date.now(),
              finishReason: partialWarning ? null : "stop",
              usage: usage
                ? {
                    promptTokens: usage.promptTokens,
                    completionTokens: usage.completionTokens,
                    totalTokens: usage.totalTokens,
                  }
                : undefined,
            };
          } catch (error) {
            if (error instanceof AIRequestAbortedError || abortController.signal.aborted) {
              return;
            }

            yield {
              type: "RUN_ERROR",
              runId,
              model: AI_MODEL,
              timestamp: Date.now(),
              error: {
                message: error instanceof Error ? error.message : "Stream error",
              },
            };
          }
        }

        return toServerSentEventsResponse(createAnalysisStream(), {
          abortController,
          headers: {
            "Cache-Control": "no-store, no-transform",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
