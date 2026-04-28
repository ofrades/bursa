import { randomUUID } from "crypto";
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
  saveAnalysisFromStreamedText,
  type AIUsage,
} from "../../../server/recommend";
import { markAnalysisStarted, markAnalysisFinished } from "../../../server/active-analyses";

const MIN_WALLET_BALANCE_CENTS = 10; // require at least €0.10 to start
const STREAM_HEARTBEAT_MS = 15_000;

// POST /api/analyze/stream
// Streams AI analysis via Server-Sent Events.
//
// The AI call and save are intentionally NOT linked to request.signal.
// If the client navigates away mid-stream the analysis keeps running in the
// background and is persisted to the DB.  The client can reload the page to
// see the saved result.
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

        // Track client connection separately from the AI abort.
        // When the client disconnects we stop sending SSE events but the AI
        // call and DB save continue running so the analysis is never lost.
        let clientConnected = true;
        request.signal.addEventListener(
          "abort",
          () => {
            clientConnected = false;
          },
          { once: true },
        );

        const encoder = new TextEncoder();

        function send(controller: ReadableStreamDefaultController, obj: unknown) {
          if (!clientConnected) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          } catch {
            clientConnected = false;
          }
        }

        const stream = new ReadableStream({
          start(controller) {
            // Background task — runs to completion regardless of client connection.
            void (async () => {
              const runId = randomUUID();
              const messageId = randomUUID();
              let usage: AIUsage | null = null;
              let accumulatedText = "";
              let partialWarning: string | null = null;

              markAnalysisStarted(symbol);
              try {
                // Start the HTTP response immediately before any data fetching.
                send(controller, {
                  type: "RUN_STARTED",
                  runId,
                  model: AI_MODEL,
                  timestamp: Date.now(),
                });

                // Gather stock data now that the HTTP response has already started.
                const [stockData, memory] = await Promise.all([
                  gatherStockData(symbol),
                  readMemory(symbol),
                ]);

                const setupContext = [
                  `Daily 21 EMA: $${stockData.ema21Daily?.toFixed(2) ?? "N/A"} (${stockData.priceVsEMA21?.toFixed(1) ?? "N/A"}% vs price)`,
                  `Weekly 21 EMA: $${stockData.weeklyEma21?.toFixed(2) ?? "N/A"} (${stockData.priceVsWeeklyEMA21?.toFixed(1) ?? "N/A"}% vs price)`,
                  `Volume trend: ${stockData.volumeTrend?.toFixed(1) ?? "N/A"}%`,
                ].join(" | ");

                const messages = buildPrompt(
                  stockData,
                  memory,
                  setupContext,
                  false,
                  weekStart,
                  weekEnd,
                );

                // Stream AI chunks — NOT aborted when client disconnects.
                let startedTextMessage = false;

                const iterator = callAIStream(messages)[Symbol.asyncIterator]();
                let nextChunk = iterator.next();

                while (true) {
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

                  if (heartbeatTimer) clearTimeout(heartbeatTimer);

                  if (result.kind === "heartbeat") {
                    send(controller, {
                      type: "CUSTOM",
                      name: "heartbeat",
                      model: AI_MODEL,
                      timestamp: Date.now(),
                    });
                    continue;
                  }

                  if (result.value.done) break;

                  const chunk = result.value.value;
                  nextChunk = iterator.next();

                  if (chunk.type === "delta") {
                    if (!startedTextMessage) {
                      startedTextMessage = true;
                      send(controller, {
                        type: "TEXT_MESSAGE_START",
                        messageId,
                        role: "assistant",
                        model: AI_MODEL,
                        timestamp: Date.now(),
                      });
                    }
                    accumulatedText += chunk.delta;
                    send(controller, {
                      type: "TEXT_MESSAGE_CONTENT",
                      messageId,
                      delta: chunk.delta,
                      model: AI_MODEL,
                      timestamp: Date.now(),
                    });
                    continue;
                  }

                  if (chunk.type === "warning") {
                    partialWarning = chunk.warning;
                    continue;
                  }

                  usage = chunk.usage;
                }

                if (startedTextMessage) {
                  send(controller, {
                    type: "TEXT_MESSAGE_END",
                    messageId,
                    model: usage?.model ?? AI_MODEL,
                    timestamp: Date.now(),
                  });
                }

                // Billing — always runs even if client is gone.
                let billedCents: number | null = null;
                if (!isAdmin && usage) {
                  const billing = await chargeUserForUsage(db, sessionSub, symbol, usage);
                  billedCents = billing.billedCents;
                }

                if (usage) {
                  send(controller, {
                    type: "CUSTOM",
                    name: "openrouter-usage",
                    model: usage.model,
                    timestamp: Date.now(),
                    value: { ...usage, billedCents },
                  });
                }

                if (partialWarning) {
                  send(controller, {
                    type: "CUSTOM",
                    name: "analysis-warning",
                    model: AI_MODEL,
                    timestamp: Date.now(),
                    value: { message: partialWarning, kind: "partial-output" },
                  });
                }

                // Save analysis to DB — always runs even if client disconnected.
                let savedId: string | null = null;
                if (accumulatedText && !partialWarning) {
                  try {
                    savedId = await saveAnalysisFromStreamedText({
                      db,
                      symbol,
                      rawText: accumulatedText,
                      stockData,
                      userId: sessionSub,
                      weekStart,
                      weekEnd,
                    });
                  } catch (saveErr) {
                    // eslint-disable-next-line no-console
                    console.error("[stream] save failed:", saveErr);
                  }
                }

                // Tell the client the analysis is persisted so it can reload.
                if (savedId) {
                  send(controller, {
                    type: "CUSTOM",
                    name: "analysis-saved",
                    model: AI_MODEL,
                    timestamp: Date.now(),
                    value: { analysisId: savedId },
                  });
                }

                send(controller, {
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
                });

                if (clientConnected) {
                  try {
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  } catch {
                    // client gone
                  }
                }
              } catch (error) {
                if (error instanceof AIRequestAbortedError) {
                  // AI timed out — not a client disconnect, log it
                  // eslint-disable-next-line no-console
                  console.error("[stream] AI request aborted:", error.message);
                } else {
                  send(controller, {
                    type: "RUN_ERROR",
                    runId,
                    model: AI_MODEL,
                    timestamp: Date.now(),
                    error: {
                      message: error instanceof Error ? error.message : "Stream error",
                    },
                  });
                }
              } finally {
                markAnalysisFinished(symbol);
                try {
                  controller.close();
                } catch {
                  /* already closed */
                }
              }
            })();
          },
          cancel() {
            clientConnected = false;
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
