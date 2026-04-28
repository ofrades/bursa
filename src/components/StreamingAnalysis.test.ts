import { describe, expect, it } from "vite-plus/test";

import type { StreamingState } from "../hooks/useStreamingAnalysis";
import { shouldShowLiveTranscript } from "../lib/stream-visibility";

function createState(overrides: Partial<StreamingState> = {}): StreamingState {
  return {
    isLoading: false,
    isComplete: false,
    analysisSaved: false,
    text: "",
    error: null,
    warning: null,
    ...overrides,
  };
}

describe("StreamingAnalysis live transcript visibility", () => {
  it("keeps the live transcript visible while the stream is still loading, even after partial opportunity JSON is parseable", () => {
    const state = createState({
      isLoading: true,
      text: '1. OPPORTUNITY_JSON:\n{"secularBet":"Apple is the dominant gateway"',
    });

    expect(shouldShowLiveTranscript(state, true)).toBe(true);
  });

  it("hides the live transcript after the stream completes and the structured opportunity card can take over", () => {
    const state = createState({
      isLoading: false,
      isComplete: true,
      text: '1. OPPORTUNITY_JSON:\n{"secularBet":"Apple is the dominant gateway"}',
    });

    expect(shouldShowLiveTranscript(state, true)).toBe(false);
  });

  it("still shows the transcript after completion when no structured opportunity section was produced", () => {
    const state = createState({
      isLoading: false,
      isComplete: true,
      text: "Live model output without any section markers yet",
    });

    expect(shouldShowLiveTranscript(state, false)).toBe(true);
  });
});
