import { describe, expect, it } from "vite-plus/test";
import type { MacroThesis } from "./simple-analysis";
import type { StockThesis } from "./stock-thesis";
import {
  getLongTermRecommendation,
  getLongTermRecommendationFromJson,
  getWeeklyRecommendationDisplay,
} from "./recommendation-labels";

function createThesis(ownability: StockThesis["ownability"]): StockThesis {
  return {
    version: "v1",
    title: "Test thesis",
    summary: "Test summary",
    tone: ownability.tone,
    confidence: {
      base: 70,
      adjusted: 70,
      delta: 0,
    },
    ownability,
    actionability: {
      title: "Entry window",
      value: "Wait",
      tone: "balanced",
      summary: "Wait for a cleaner setup.",
    },
    survivability: {
      title: "Risk check",
      value: "Watch",
      tone: "balanced",
      summary: "Risk is manageable.",
    },
    alignment: {
      title: "Alignment",
      value: "Mixed",
      tone: "balanced",
      summary: "Neither horizon fully wins.",
    },
    support: [],
    limits: [],
  };
}

function createMacroThesis(confidence: number): MacroThesis {
  return {
    secularBet: "AI compute demand keeps pulling semis and power higher.",
    dependencyChain: ["AI adoption -> compute demand -> chip demand"],
    demandGap: "Supply still trails projected multi-year demand.",
    sCurvePosition: "crossing_chasm",
    timeHorizon: "5y",
    loadBearingAssumptions: ["Demand persists"],
    falsificationSignals: ["Capex collapses"],
    opportunityScore: 78,
    confidence,
  };
}

describe("recommendation labels", () => {
  it("maps ownability to a long-term own label using agent long-term confidence", () => {
    const label = getLongTermRecommendation(
      createThesis({
        title: "Long-term exposure",
        value: "Own",
        tone: "supportive",
        summary: "The business backdrop is strong enough for long-term exposure.",
      }),
      createMacroThesis(81),
    );

    expect(label).toMatchObject({
      value: "Own",
      label: "Long-term own",
      tone: "supportive",
      confidence: 81,
    });
  });

  it("maps ownability to a long-term avoid label using agent long-term confidence", () => {
    const label = getLongTermRecommendation(
      createThesis({
        title: "Long-term exposure",
        value: "Avoid",
        tone: "cautious",
        summary: "The business or valuation backdrop is not ready for long-term conviction.",
      }),
      createMacroThesis(34),
    );

    expect(label).toMatchObject({
      value: "Avoid",
      label: "Long-term avoid",
      tone: "cautious",
      confidence: 34,
    });
  });

  it("parses persisted snapshots into a watch label and uses macro confidence", () => {
    const label = getLongTermRecommendationFromJson(
      JSON.stringify(
        createThesis({
          title: "Long-term exposure",
          value: "Maybe own",
          tone: "balanced",
          summary: "There is a case here, but one sleeve still needs work.",
        }),
      ),
      JSON.stringify(createMacroThesis(52)),
    );

    expect(label).toMatchObject({
      value: "Maybe own",
      label: "Long-term watch",
      tone: "balanced",
      confidence: 52,
    });
  });

  it("leaves long-term confidence empty when the agent did not provide one", () => {
    const label = getLongTermRecommendation(
      createThesis({
        title: "Long-term exposure",
        value: "Own",
        tone: "supportive",
        summary: "The business backdrop is strong enough for long-term exposure.",
      }),
      null,
    );

    expect(label?.confidence).toBeNull();
  });

  it("uses the agent weekly call when present", () => {
    const weekly = getWeeklyRecommendationDisplay(
      JSON.stringify({ signal: "BUY", weeklyCall: "WAIT", confidence: 47 }),
      "BUY",
      47,
    );

    expect(weekly).toMatchObject({ value: "WAIT", confidence: 47 });
  });

  it("falls back to the directional signal when no weekly call exists", () => {
    const weekly = getWeeklyRecommendationDisplay(
      JSON.stringify({ signal: "SELL", confidence: 61 }),
      "SELL",
      61,
    );

    expect(weekly).toMatchObject({ value: "SELL", confidence: 61 });
  });
});
