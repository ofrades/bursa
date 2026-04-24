import { useState, useCallback, useRef } from "react";

export type StreamingState = {
  isLoading: boolean;
  isComplete: boolean;
  text: string;
  error: string | null;
};

export function useStreamingAnalysis() {
  const [state, setState] = useState<StreamingState>({
    isLoading: false,
    isComplete: false,
    text: "",
    error: null,
  });

  const abortRef = useRef<(() => void) | null>(null);

  const start = useCallback(async (symbol: string) => {
    // Reset state
    setState({
      isLoading: true,
      isComplete: false,
      text: "",
      error: null,
    });

    try {
      const response = await fetch("/api/analyze/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });

      if (response.status === 401) {
        setState((s) => ({ ...s, isLoading: false, error: "Unauthorized" }));
        return;
      }
      if (response.status === 402) {
        setState((s) => ({ ...s, isLoading: false, error: "INSUFFICIENT_FUNDS" }));
        return;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "Request failed");
        setState((s) => ({ ...s, isLoading: false, error: text }));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setState((s) => ({ ...s, isLoading: false, error: "No response body" }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      abortRef.current = () => {
        reader.cancel();
      };

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
            const parsed = JSON.parse(payload);
            if (parsed.error) {
              setState((s) => ({
                ...s,
                isLoading: false,
                error: parsed.error,
              }));
              abortRef.current = null;
              return;
            }
            if (parsed.delta) {
              setState((s) => ({
                ...s,
                text: s.text + parsed.delta,
              }));
            }
            if (parsed.done && parsed.costCents != null) {
              // Final metadata — cost already deducted server-side
            }
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }

      setState((s) => ({ ...s, isLoading: false, isComplete: true }));
      abortRef.current = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stream failed";
      setState((s) => ({ ...s, isLoading: false, error: message }));
      abortRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setState((s) => ({ ...s, isLoading: false }));
  }, []);

  return { state, start, stop };
}
