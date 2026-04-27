import { useState, useCallback, useRef } from "react";

type StreamingEvent =
  | { type: "TEXT_MESSAGE_CONTENT"; delta?: string }
  | { type: "RUN_ERROR"; error?: { message?: string } }
  | { type: "RUN_FINISHED"; finishReason?: string | null }
  | { type: "CUSTOM"; name?: string; value?: unknown };

export type StreamingState = {
  isLoading: boolean;
  isComplete: boolean;
  text: string;
  error: string | null;
  warning: string | null;
  canSave: boolean;
};

const INITIAL_STATE: StreamingState = {
  isLoading: false,
  isComplete: false,
  text: "",
  error: null,
  warning: null,
  canSave: true,
};

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function useStreamingAnalysis() {
  const [state, setState] = useState<StreamingState>(INITIAL_STATE);

  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (symbol: string) => {
    abortRef.current?.abort();

    const abortController = new AbortController();
    abortRef.current = abortController;

    setState({
      ...INITIAL_STATE,
      isLoading: true,
    });

    try {
      const response = await fetch("/api/analyze/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
        signal: abortController.signal,
      });

      if (response.status === 401) {
        setState((s) => ({ ...s, isLoading: false, error: "Unauthorized" }));
        abortRef.current = null;
        return;
      }
      if (response.status === 402) {
        setState((s) => ({ ...s, isLoading: false, error: "INSUFFICIENT_FUNDS" }));
        abortRef.current = null;
        return;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "Request failed");
        setState((s) => ({ ...s, isLoading: false, error: text }));
        abortRef.current = null;
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setState((s) => ({ ...s, isLoading: false, error: "No response body" }));
        abortRef.current = null;
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          const payload = trimmed.slice(6).trim();
          if (payload === "[DONE]") {
            setState((s) => ({ ...s, isLoading: false, isComplete: true }));
            abortRef.current = null;
            return;
          }

          try {
            const parsed = JSON.parse(payload) as StreamingEvent;

            if (parsed.type === "TEXT_MESSAGE_CONTENT" && typeof parsed.delta === "string") {
              setState((s) => ({
                ...s,
                text: s.text + parsed.delta,
              }));
              continue;
            }

            if (parsed.type === "RUN_ERROR") {
              setState((s) => ({
                ...s,
                isLoading: false,
                error: parsed.error?.message ?? "Stream error",
              }));
              abortRef.current = null;
              return;
            }

            if (parsed.type === "CUSTOM") {
              const customValue =
                parsed.value && typeof parsed.value === "object"
                  ? (parsed.value as { message?: unknown })
                  : null;

              if (parsed.name === "analysis-warning" && typeof customValue?.message === "string") {
                const warningMessage = customValue.message;
                setState((s) => ({
                  ...s,
                  warning: warningMessage,
                  canSave: false,
                }));
              }
              continue;
            }

            if (parsed.type === "RUN_FINISHED") {
              setState((s) => ({
                ...s,
                isLoading: false,
                isComplete: true,
                canSave: s.canSave && parsed.finishReason !== null,
              }));
              abortRef.current = null;
              continue;
            }
          } catch {
            // Ignore malformed SSE lines.
          }
        }
      }

      setState((s) => ({ ...s, isLoading: false, isComplete: true }));
      abortRef.current = null;
    } catch (err) {
      if (isAbortError(err)) {
        setState((s) => ({ ...s, isLoading: false }));
        if (abortRef.current === abortController) {
          abortRef.current = null;
        }
        return;
      }

      const message = err instanceof Error ? err.message : "Stream failed";
      setState((s) => ({ ...s, isLoading: false, error: message }));
      abortRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => ({ ...s, isLoading: false }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { state, start, stop, reset };
}
