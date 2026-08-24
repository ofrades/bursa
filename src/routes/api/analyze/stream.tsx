import {
  chat,
  toServerSentEventsResponse,
  type ChatMiddleware,
  type StreamChunk,
  type UsageInfo,
} from "@tanstack/ai";
import { openaiCompatible } from "@tanstack/ai-openai/compatible";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { desc, eq } from "drizzle-orm";
import { analysisOutputSchema, type AnalysisOutput } from "../../../lib/analysis-output-schema";
import { z } from "zod";
import { normalizeAnalysisOutput } from "../../../lib/analysis-normalize";
import { getSecret } from "../../../secrets";
import { getAuthenticatedUser } from "../../../lib/auth";
import { releaseAnalysis, reserveAnalysis } from "../../../lib/analysis-reservation";

// Module-level log fires every time Vite re-evaluates this file (HMR reload).
// If you don't see this in the dev server terminal, the file isn't being
// reloaded and you need to restart `bun run dev`.
// eslint-disable-next-line no-console
console.log(`[stream] module loaded at ${new Date().toISOString()}`);
import {
  gatherAnalysisSnapshot,
  buildStructuredPrompt,
  readMemory,
  chargeUserForUsage,
  saveAnalysisOutput,
  type AIUsage,
  type PriorAnalysisContext,
} from "../../../server/recommend";
import { markAnalysisStarted, markAnalysisFinished } from "../../../server/active-analyses";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const AI_MAX_OUTPUT_TOKENS = 8_000;
// Pinned to one model for now; we previously passed an empty model string,
// which OpenRouter silently coerced. Make the choice explicit and overridable
// per-environment so the chat() call always has a concrete model to route.
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash";

function getOpenRouterModel(): string {
  return process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
}

function getOpenRouterAttributionHeaders() {
  const referer = process.env.OPENROUTER_HTTP_REFERER ?? process.env.BETTER_AUTH_URL;
  const title = process.env.OPENROUTER_APP_TITLE ?? "Bursa";

  const refererHeaders = referer ? { "HTTP-Referer": referer } : undefined;

  return {
    ...refererHeaders,
    "X-OpenRouter-Title": title,
    "X-OpenRouter-Cache": "true",
  };
}

function normalizedUsage(usage: UsageInfo, model: string): AIUsage {
  const promptTokens = usage.promptTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;
  const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;
  // TanStack AI 0.25+ exposes the provider-reported `cost` on the usage
  // object. OpenRouter populates this on the wire with the real USD cost of
  // the routed request (handles BYOK, cached-token pricing, fallbacks). Fall
  // back to the previous conservative estimate when the provider didn't
  // report one.
  const reportedCost = z.number().finite().nullable().catch(null).parse(usage.cost);
  const costUsd = reportedCost ?? totalTokens * (0.4 / 1_000_000);

  return {
    ...usage,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    model,
  };
}

function addUsage(current: AIUsage | null, next: AIUsage): AIUsage {
  if (!current) return next;
  return {
    ...next,
    promptTokens: current.promptTokens + next.promptTokens,
    completionTokens: current.completionTokens + next.completionTokens,
    totalTokens: current.totalTokens + next.totalTokens,
    costUsd: current.costUsd + next.costUsd,
  };
}

// POST /api/analyze/stream
// Streams structured AI analysis via TanStack AI's outputSchema pipeline.
export const Route = createFileRoute("/api/analyze/stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // eslint-disable-next-line no-console
        console.log(`[stream] handler entered at ${new Date().toISOString()}`);
        const session = await getAuthenticatedUser(request);
        if (!session) {
          // eslint-disable-next-line no-console
          console.log("[stream] no session, returning 401");
          return new Response("Unauthorized", { status: 401 });
        }
        // eslint-disable-next-line no-console
        console.log(`[stream] session ok, sub=${session.sub}`);
        const sessionSub = session.sub;

        const body = (await request.json().catch(() => ({}))) as {
          symbol?: string;
          data?: { symbol?: string };
        };
        const requestedSymbol = (body.data?.symbol ?? body.symbol)?.toUpperCase();
        // eslint-disable-next-line no-console
        console.log(`[stream] body parsed, requestedSymbol=${requestedSymbol}`);
        if (!requestedSymbol) {
          return new Response("Missing symbol", { status: 400 });
        }
        const symbol = requestedSymbol;
        // eslint-disable-next-line no-console
        console.log(`[stream] symbol=${symbol}, importing db...`);

        const { getDb } = await import("../../../lib/db");
        const { stockAnalysis } = await import("../../../lib/schema");
        const db = await getDb();

        const reservation = await reserveAnalysis(db, session.sub);
        if ("failure" in reservation) {
          const response = {
            "not-found": [401, "Unauthorized"],
            busy: [409, "ANALYSIS_IN_PROGRESS"],
            "rate-limited": [429, "RATE_LIMITED"],
            "insufficient-funds": [402, "INSUFFICIENT_FUNDS"],
          }[reservation.failure] as [number, string];
          return new Response(response[1], { status: response[0] });
        }
        const isAdmin = reservation.isAdmin;
        const reservationId = reservation.id;
        // eslint-disable-next-line no-console
        console.log(`[stream] db loaded, isAdmin=${isAdmin}`);

        const today = new Date();
        const analysisDate = format(today, "yyyy-MM-dd");
        const abortController = new AbortController();

        // Safety net: if the model hangs (no RUN_FINISHED within 4 minutes),
        // abort the request so the client sees an error and the user can
        // retry, instead of sitting on a spinning button forever. OpenRouter
        // + 8K output tokens for gemini-2.5-flash should comfortably finish
        // in well under 2 minutes on a normal connection.
        const STREAM_TIMEOUT_MS = 4 * 60 * 1000;
        const streamTimeout = setTimeout(() => {
          // eslint-disable-next-line no-console
          console.error(`[stream] timeout after ${STREAM_TIMEOUT_MS}ms for ${symbol}`);
          abortController.abort(new Error("Stream timeout"));
        }, STREAM_TIMEOUT_MS);
        // If the request finishes (success or error) before the timeout
        // fires, clear it so we don't leak timers.
        request.signal.addEventListener("abort", () => clearTimeout(streamTimeout));

        markAnalysisStarted(symbol);
        // eslint-disable-next-line no-console
        console.log(`[stream] entering try block for ${symbol}, gathering analysis snapshot...`);

        try {
          const [analysisSnapshot, memory, priorRows] = await Promise.all([
            gatherAnalysisSnapshot(symbol),
            readMemory(symbol),
            db
              .select({
                analysisDate: stockAnalysis.analysisDate,
                signal: stockAnalysis.signal,
                reasoning: stockAnalysis.reasoning,
                priceAtAnalysis: stockAnalysis.priceAtAnalysis,
              })
              .from(stockAnalysis)
              .where(eq(stockAnalysis.symbol, symbol))
              .orderBy(desc(stockAnalysis.updatedAt))
              .limit(1),
          ]);

          const priorRow = priorRows[0] ?? null;
          const priorReasoning = priorRow?.reasoning
            ? (() => {
                try {
                  return JSON.parse(priorRow.reasoning) as Record<string, string>;
                } catch {
                  return null;
                }
              })()
            : null;
          const prior: PriorAnalysisContext | null = priorRow
            ? {
                analysisDate: priorRow.analysisDate,
                signal: priorRow.signal,
                weeklyCall: priorReasoning?.weeklyCall ?? null,
                priceAtAnalysis: priorRow.priceAtAnalysis,
                weeklyOutlook: priorReasoning?.weeklyOutlook ?? null,
              }
            : null;

          const { stockData, simpleAnalysis, dividendData } = analysisSnapshot;

          // eslint-disable-next-line no-console
          console.log(`[stream] analysis snapshot gathered, building prompt for ${symbol}...`);
          const messages = buildStructuredPrompt(stockData, memory, false, analysisDate, prior, {
            simpleAnalysis,
            dividendData,
          });
          // eslint-disable-next-line no-console
          console.log(
            `[stream] prompt built (${messages.system.length + messages.user.length} chars), getting model...`,
          );
          const modelName = getOpenRouterModel();
          const apiKey = await getSecret("OPENROUTER_API_KEY");
          if (!apiKey) throw new Error("OpenRouter not configured");
          const openrouterFactory = openaiCompatible({
            name: "openrouter",
            baseURL: OPENROUTER_BASE_URL,
            apiKey,
            models: [modelName] as const,
            defaultHeaders: getOpenRouterAttributionHeaders(),
          });
          // eslint-disable-next-line no-console
          console.log(`[stream] model=${modelName}, creating adapter...`);
          const adapter = openrouterFactory(modelName);
          let capturedUsage: AIUsage | null = null;
          const usageMiddleware: ChatMiddleware = {
            name: "capture-billing-usage",
            onUsage(_, usage) {
              capturedUsage = addUsage(capturedUsage, normalizedUsage(usage, modelName));
            },
          };
          // eslint-disable-next-line no-console
          console.log(`[stream] adapter created, calling chat()...`);
          const streamStartedAt = Date.now();

          // eslint-disable-next-line no-console
          console.log(`[stream] starting ${symbol} with model=${modelName}`);

          const aiStream = chat({
            adapter,
            systemPrompts: [messages.system],
            messages: [{ role: "user", content: messages.user }],
            outputSchema: analysisOutputSchema,
            middleware: [usageMiddleware],
            stream: true,
            abortController,
            // TanStack AI 0.27 moved sampling options off the root and into
            // provider-native modelOptions. OpenRouter Chat Completions uses
            // `maxCompletionTokens`. The `reasoning` field is OpenRouter's
            // reasoning-effort control — keep it off so non-reasoning models
            // don't pay for hidden thinking tokens.
            modelOptions: {
              maxCompletionTokens: AI_MAX_OUTPUT_TOKENS,
              reasoning: { effort: "none" },
            } as never,
          });

          async function* withPersistence(): AsyncIterable<StreamChunk> {
            let finalOutput: AnalysisOutput | null = null;
            let savedId: string | null = null;
            let chunkCount = 0;
            let reservationSettled = false;

            try {
              // eslint-disable-next-line no-console
              console.log(`[stream] ${symbol} entering for-await loop on aiStream`);
              for await (const chunk of aiStream as AsyncIterable<StreamChunk>) {
                // eslint-disable-next-line no-console
                if (chunkCount === 0)
                  console.log(`[stream] ${symbol} FIRST CHUNK received: type=${chunk.type}`);
                chunkCount++;
                if (chunk.type === "CUSTOM" && chunk.name === "structured-output.complete") {
                  finalOutput = normalizeAnalysisOutput(
                    (chunk.value as { object: AnalysisOutput }).object,
                  );

                  // In TanStack AI structured streaming, RUN_FINISHED may be
                  // suppressed from the public stream. Persist as soon as the
                  // schema-validated object is complete instead of waiting for
                  // RUN_FINISHED; otherwise analyses render but never update the
                  // DB timestamp.
                  try {
                    savedId = await saveAnalysisOutput({
                      db,
                      symbol,
                      output: finalOutput,
                      stockData,
                      analysisEvidence: { simpleAnalysis, dividendData },
                      userId: sessionSub,
                      analysisDate,
                    });
                    // eslint-disable-next-line no-console
                    console.log(`[stream] saved ${symbol} analysis id=${savedId}`);
                  } catch (saveErr) {
                    // eslint-disable-next-line no-console
                    console.error("[stream] save failed:", saveErr);
                  }

                  if (!isAdmin && !reservationSettled) {
                    const billing = await chargeUserForUsage(
                      sessionSub,
                      reservationId,
                      symbol,
                      capturedUsage,
                    );
                    reservationSettled = true;
                    yield {
                      type: "CUSTOM",
                      name: "openrouter-usage",
                      model: modelName as never,
                      timestamp: Date.now(),
                      value: { ...capturedUsage, ...billing },
                    } as StreamChunk;
                  }

                  yield {
                    ...chunk,
                    value: {
                      ...(chunk.value as { object: AnalysisOutput }),
                      object: finalOutput,
                    },
                  } as StreamChunk;

                  if (savedId) {
                    yield {
                      type: "CUSTOM",
                      name: "analysis-saved",
                      model: "" as never,
                      timestamp: Date.now(),
                      value: { analysisId: savedId },
                    } as StreamChunk;
                  }
                  continue;
                }

                if (chunk.type === "RUN_FINISHED") {
                  yield chunk;
                  continue;
                }

                yield chunk;
              }
            } catch (streamErr) {
              // Surface a clear error event to the client instead of letting
              // the connection die silently. The user sees a red error in the
              // UI and we get a log line saying where in the stream it died.
              // eslint-disable-next-line no-console
              console.error(
                `[stream] ${symbol} error after ${chunkCount} chunks t=${((Date.now() - streamStartedAt) / 1000).toFixed(1)}s:`,
                streamErr,
              );
              yield {
                type: "CUSTOM",
                name: "analysis-error",
                model: "" as never,
                timestamp: Date.now(),
                value: {
                  message: streamErr instanceof Error ? streamErr.message : String(streamErr),
                  chunksReceived: chunkCount,
                  elapsedSeconds: (Date.now() - streamStartedAt) / 1000,
                },
              } as StreamChunk;
              throw streamErr;
            } finally {
              if (!reservationSettled) {
                await releaseAnalysis(db, sessionSub, reservationId);
              }
              clearTimeout(streamTimeout);
              markAnalysisFinished(symbol);
            }
          }

          // eslint-disable-next-line no-console
          console.log(`[stream] calling toServerSentEventsResponse for ${symbol}...`);
          const response = toServerSentEventsResponse(withPersistence(), {
            abortController,
            headers: {
              "Cache-Control": "no-store, no-transform",
              "X-Accel-Buffering": "no",
              "X-Content-Type-Options": "nosniff",
            },
          });
          // eslint-disable-next-line no-console
          console.log(`[stream] toServerSentEventsResponse returned, returning response to client`);
          return response;
        } catch (error) {
          await releaseAnalysis(db, sessionSub, reservationId);
          clearTimeout(streamTimeout);
          markAnalysisFinished(symbol);
          throw error;
        }
      },
    },
  },
});
