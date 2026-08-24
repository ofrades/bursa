import type { StreamingState } from "../hooks/useStreamingAnalysis";

export function shouldShowLiveTranscript(state: StreamingState, hasOpportunity: boolean) {
  return state.text.length > 0 && (state.isLoading || !hasOpportunity);
}
