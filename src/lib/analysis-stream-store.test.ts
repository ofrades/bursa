import { describe, expect, it } from "vite-plus/test";

import { analysisStreamStore, STREAM_INITIAL_STATE } from "./analysis-stream-store";

describe("analysisStreamStore", () => {
  it("notifies subscribers when a cleared stream should reset the UI back to idle", () => {
    const symbol = `TEST-${Date.now()}`;
    const snapshots: Array<ReturnType<typeof analysisStreamStore.get>> = [];

    const unsubscribe = analysisStreamStore.subscribe(symbol, () => {
      snapshots.push(analysisStreamStore.get(symbol));
    });

    analysisStreamStore.init(symbol, () => {});
    analysisStreamStore.update(symbol, {
      isLoading: false,
      isComplete: true,
      analysisSaved: true,
    });
    analysisStreamStore.appendText(symbol, '1. OPPORTUNITY_JSON:\n{"secularBet":"test"}');

    analysisStreamStore.clear(symbol);

    expect(snapshots.at(-1)).toBeNull();
    expect(analysisStreamStore.get(symbol)).toBeNull();

    unsubscribe();
    analysisStreamStore.clear(symbol);
  });

  it("still exposes the canonical idle state to callers that fall back when the stream is gone", () => {
    const symbol = `TEST-IDLE-${Date.now()}`;

    analysisStreamStore.init(symbol, () => {});
    analysisStreamStore.clear(symbol);

    expect(analysisStreamStore.get(symbol) ?? STREAM_INITIAL_STATE).toEqual(STREAM_INITIAL_STATE);
  });
});
