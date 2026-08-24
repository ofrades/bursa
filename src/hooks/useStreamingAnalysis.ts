import { useCallback, useMemo, useState } from "react";
import { useChat } from "@tanstack/ai-react";
import { fetchServerSentEvents } from "@tanstack/ai-client";
import {
  analysisOutputSchema,
  type AnalysisOutput,
  type PartialAnalysisOutput,
} from "../lib/analysis-output-schema";

export type StreamingState = {
  isLoading: boolean;
  isComplete: boolean;
  analysisSaved: boolean;
  text: string;
  partial: PartialAnalysisOutput;
  final: AnalysisOutput | null;
  error: string | null;
  warning: string | null;
  /** Diagnostic: how many SSE chunks we received before any error. */
  chunksBeforeError: number | null;
  /** Diagnostic: wall-clock seconds from stream start to error. */
  elapsedBeforeError: number | null;
};

const STREAM_INITIAL_STATE: StreamingState = {
  isLoading: false,
  isComplete: false,
  analysisSaved: false,
  text: "",
  partial: {},
  final: null,
  error: null,
  warning: null,
  chunksBeforeError: null,
  elapsedBeforeError: null,
};

/**
 * Connects the symbol page to TanStack AI's structured streaming hook.
 * `partial` updates directly from streamed JSON deltas and `final` is set from
 * the schema-validated `structured-output.complete` event.
 */
export function useStreamingAnalysis(symbol: string) {
  const [analysisSaved, setAnalysisSaved] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [chunksBeforeError, setChunksBeforeError] = useState<number | null>(null);
  const [elapsedBeforeError, setElapsedBeforeError] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);

  const chat = useChat({
    connection: fetchServerSentEvents("/api/analyze/stream"),
    body: { symbol },
    outputSchema: analysisOutputSchema,
    onChunk: (chunk) => {
      if (chunk.type === "RUN_STARTED") {
        setHidden(false);
        setAnalysisSaved(false);
        setWarning(null);
        setChunksBeforeError(null);
        setElapsedBeforeError(null);
      }
    },
    onCustomEvent: (eventType, value) => {
      if (eventType === "analysis-saved") {
        setAnalysisSaved(true);
      }
      if (eventType === "analysis-warning") {
        const v = value as { message?: string } | null;
        if (v?.message !== undefined) setWarning(v.message);
      }
      if (eventType === "analysis-error") {
        const v = value as {
          message?: string;
          chunksReceived?: number;
          elapsedSeconds?: number;
        } | null;
        if (v?.message !== undefined) {
          setWarning(v.message);
          setChunksBeforeError(v.chunksReceived ?? null);
          setElapsedBeforeError(v.elapsedSeconds ?? null);
        }
      }
    },
  });

  const state: StreamingState = useMemo(
    () =>
      hidden
        ? STREAM_INITIAL_STATE
        : {
            ...STREAM_INITIAL_STATE,
            isLoading: chat.isLoading,
            isComplete: chat.status === "ready" && Boolean(chat.final),
            analysisSaved,
            // Do not feed the raw structured JSON into the page transcript; render the
            // live cards from typed partial/final instead.
            text: "",
            partial: chat.partial,
            final: chat.final,
            error: chat.error?.message ?? null,
            warning,
            chunksBeforeError,
            elapsedBeforeError,
          },
    [
      analysisSaved,
      chat.error,
      chat.final,
      chat.isLoading,
      chat.partial,
      chat.status,
      hidden,
      warning,
      chunksBeforeError,
      elapsedBeforeError,
    ],
  );

  const start = useCallback(() => {
    setHidden(false);
    setAnalysisSaved(false);
    setWarning(null);
    void chat.sendMessage(`Analyze ${symbol}`);
  }, [chat, symbol]);

  const stop = useCallback(() => {
    chat.stop();
  }, [chat]);

  const reset = useCallback(() => {
    chat.clear();
    setHidden(true);
    setAnalysisSaved(false);
    setWarning(null);
  }, [chat]);

  return { state, start, stop, reset };
}
