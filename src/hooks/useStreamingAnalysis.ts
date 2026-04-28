import { useState, useCallback, useEffect } from "react";
import {
  analysisStreamStore,
  STREAM_INITIAL_STATE,
  type StreamingState,
} from "../lib/analysis-stream-store";

export type { StreamingState };

// ─── Module-level fetch runner ────────────────────────────────────────────────
// Runs independently of any React component — survives navigation.

async function runStream(symbol: string): Promise<void> {
  try {
    // No AbortSignal on the fetch — we never want navigation to kill this.
    // The server keeps the analysis running regardless; we just receive events.
    const response = await fetch("/api/analyze/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });

    if (response.status === 401) {
      analysisStreamStore.update(symbol, { isLoading: false, error: "Unauthorized" });
      return;
    }
    if (response.status === 402) {
      analysisStreamStore.update(symbol, { isLoading: false, error: "INSUFFICIENT_FUNDS" });
      return;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "Request failed");
      analysisStreamStore.update(symbol, { isLoading: false, error: text });
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      analysisStreamStore.update(symbol, { isLoading: false, error: "No response body" });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // If a new analysis was started for the same symbol (store entry replaced),
      // stop processing the old stream's events.
      if (!analysisStreamStore.isActive(symbol)) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed.startsWith("data: ")) continue;

        const payload = trimmed.slice(6).trim();
        if (payload === "[DONE]") {
          analysisStreamStore.update(symbol, { isLoading: false, isComplete: true });
          return;
        }

        try {
          const parsed = JSON.parse(payload) as {
            type: string;
            delta?: string;
            error?: { message?: string };
            finishReason?: string | null;
            name?: string;
            value?: unknown;
          };

          if (parsed.type === "TEXT_MESSAGE_CONTENT" && typeof parsed.delta === "string") {
            analysisStreamStore.appendText(symbol, parsed.delta);
            continue;
          }

          if (parsed.type === "RUN_ERROR") {
            analysisStreamStore.update(symbol, {
              isLoading: false,
              error: parsed.error?.message ?? "Stream error",
            });
            return;
          }

          if (parsed.type === "CUSTOM") {
            if (parsed.name === "analysis-saved") {
              analysisStreamStore.update(symbol, { analysisSaved: true });
            }
            if (parsed.name === "analysis-warning") {
              const v = parsed.value as { message?: string } | null;
              if (typeof v?.message === "string") {
                analysisStreamStore.update(symbol, { warning: v.message });
              }
            }
            continue;
          }

          if (parsed.type === "RUN_FINISHED") {
            analysisStreamStore.update(symbol, { isLoading: false, isComplete: true });
            continue;
          }
        } catch {
          // Ignore malformed SSE lines.
        }
      }
    }

    // Stream ended without [DONE] — mark complete anyway.
    analysisStreamStore.update(symbol, { isLoading: false, isComplete: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stream failed";
    analysisStreamStore.update(symbol, { isLoading: false, error: message });
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Connects a component to the global analysis stream for `symbol`.
 * If a stream is already running (e.g. the user navigated away and came back)
 * the component immediately receives the current in-progress state.
 */
export function useStreamingAnalysis(symbol: string) {
  const [state, setLocalState] = useState<StreamingState>(
    () => analysisStreamStore.get(symbol) ?? STREAM_INITIAL_STATE,
  );

  // On mount (and symbol change): read current store state, then subscribe.
  useEffect(() => {
    const current = analysisStreamStore.get(symbol);
    if (current) setLocalState(current);

    const unsubscribe = analysisStreamStore.subscribe(symbol, () => {
      const latest = analysisStreamStore.get(symbol);
      setLocalState(latest ?? STREAM_INITIAL_STATE);
    });

    return unsubscribe;
  }, [symbol]);

  const start = useCallback(() => {
    const abortController = new AbortController();
    // init() creates the entry AND notifies all subscribers (including this
    // component's listener) synchronously, so no need for a direct setState.
    analysisStreamStore.init(symbol, () => abortController.abort());
    void runStream(symbol);
  }, [symbol]);

  const stop = useCallback(() => {
    analysisStreamStore.abort(symbol);
    setLocalState(STREAM_INITIAL_STATE);
  }, [symbol]);

  const reset = useCallback(() => {
    analysisStreamStore.clear(symbol);
    setLocalState(STREAM_INITIAL_STATE);
  }, [symbol]);

  return { state, start, stop, reset };
}
