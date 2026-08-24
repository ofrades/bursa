import { describe, expect, it } from "vitest";

import { buildSimpleAnalysisEvidence, type SimpleAnalysisInputs } from "./simple-analysis";
import {
  buildStockThesis,
  diffStockThesis,
  parseAIStockThesis,
  parseStockThesis,
  stockThesisChangeTone,
  stockThesisChangesTone,
  STOCK_THESIS_VERSION,
} from "./stock-thesis";

function createSupportiveInput(
  overrides: Partial<SimpleAnalysisInputs> = {},
): SimpleAnalysisInputs {
  return {
    symbol: "GOOD",
    salesHistory: [
      { label: "2022", date: "2022-12-31", value: 100 },
      { label: "2023", date: "2023-12-31", value: 120 },
      { label: "2024", date: "2024-12-31", value: 130 },
      { label: "2025", date: "2025-12-31", value: 145 },
    ],
    cashHistory: [
      { label: "2022", date: "2022-12-31", value: 8 },
      { label: "2023", date: "2023-12-31", value: 12 },
      { label: "2024", date: "2024-12-31", value: 14 },
      { label: "2025", date: "2025-12-31", value: 18 },
    ],
    priceHistory: [
      { label: "2022", date: "2022-12-31", value: 10 },
      { label: "2023", date: "2023-12-31", value: 11 },
      { label: "2024", date: "2024-12-31", value: 12 },
      { label: "2025", date: "2025-12-31", value: 13 },
    ],
    shareCountHistory: [
      { label: "2022", date: "2022-12-31", value: 100 },
      { label: "2023", date: "2023-12-31", value: 98 },
      { label: "2024", date: "2024-12-31", value: 96 },
      { label: "2025", date: "2025-12-31", value: 94 },
    ],
    currentPrice: 13,
    marketCap: 150,
    totalDebt: 20,
    totalCash: 80,
    freeCashflow: 18,
    ebitda: 25,
    operatingCashflow: 20,
    currentRatio: 1.6,
    quickRatio: 1.4,
    profitMargin: 0.18,
    revenueGrowth: 0.12,
    operatingMargin: 0.22,
    grossMargin: 0.48,
    returnOnEquity: 0.2,
    returnOnAssets: 0.09,
    earningsGrowth: 0.11,
    peRatio: 16,
    forwardPE: 14,
    ...overrides,
  };
}

function createStrainedInput(overrides: Partial<SimpleAnalysisInputs> = {}): SimpleAnalysisInputs {
  return {
    symbol: "BAD",
    salesHistory: [
      { label: "2022", date: "2022-12-31", value: 180 },
      { label: "2023", date: "2023-12-31", value: 160 },
      { label: "2024", date: "2024-12-31", value: 130 },
      { label: "2025", date: "2025-12-31", value: 100 },
    ],
    cashHistory: [
      { label: "2022", date: "2022-12-31", value: 20 },
      { label: "2023", date: "2023-12-31", value: 5 },
      { label: "2024", date: "2024-12-31", value: -5 },
      { label: "2025", date: "2025-12-31", value: -12 },
    ],
    priceHistory: [
      { label: "2022", date: "2022-12-31", value: 10 },
      { label: "2023", date: "2023-12-31", value: 18 },
      { label: "2024", date: "2024-12-31", value: 25 },
      { label: "2025", date: "2025-12-31", value: 30 },
    ],
    shareCountHistory: [
      { label: "2022", date: "2022-12-31", value: 100 },
      { label: "2023", date: "2023-12-31", value: 106 },
      { label: "2024", date: "2024-12-31", value: 112 },
      { label: "2025", date: "2025-12-31", value: 120 },
    ],
    currentPrice: 30,
    marketCap: 1200,
    totalDebt: 300,
    totalCash: 50,
    freeCashflow: 10,
    ebitda: 35,
    operatingCashflow: 18,
    currentRatio: 0.8,
    quickRatio: 0.6,
    profitMargin: 0.03,
    revenueGrowth: -0.12,
    operatingMargin: 0.05,
    grossMargin: 0.18,
    returnOnEquity: 0.04,
    returnOnAssets: 0.01,
    earningsGrowth: -0.16,
    peRatio: 38,
    forwardPE: 33,
    ...overrides,
  };
}

describe("buildStockThesis", () => {
  it("shows a clean long-term build when business and timing align", () => {
    const evidence = buildSimpleAnalysisEvidence(createSupportiveInput());
    const thesis = buildStockThesis(
      {
        signal: "BUY",
        cycle: "MARKUP",
        cycleTimeframe: "MEDIUM",
        confidence: 74,
        riskLevel: "LOW",
        weeklyTrend: "uptrend",
        consolidationBreakout21EMA: true,
        keyBullishFactors: ["Trend remains strong"],
        earningsEstimateDelta30dPct: 7,
        revisionBalance30d: 3,
        daysToEarnings: 40,
        earningsEventRisk: "clear",
      },
      evidence,
    );

    expect(thesis).not.toBeNull();
    expect(thesis).toMatchObject({
      title: "Build long-term exposure",
      ownability: { value: "Own" },
      actionability: { value: "Add now" },
      survivability: { value: "Safe" },
      alignment: { value: "Aligned" },
    });
    expect(thesis?.confidence.adjusted).toBeGreaterThan(thesis?.confidence.base ?? 0);
    expect(thesis?.version).toBe(STOCK_THESIS_VERSION);
  });

  it("honors a WAIT weekly call even when the cycle bias is bullish", () => {
    const evidence = buildSimpleAnalysisEvidence(createSupportiveInput());
    const thesis = buildStockThesis(
      {
        signal: "BUY",
        weeklyCall: "WAIT",
        cycle: "MARKUP",
        cycleTimeframe: "MEDIUM",
        confidence: 76,
        riskLevel: "LOW",
        weeklyTrend: "uptrend",
        weeklyOutlook: "The business is fine, but the entry is not clean this week.",
      },
      evidence,
    );

    expect(thesis).not.toBeNull();
    expect(thesis?.actionability.value).toBe("Wait");
    expect(thesis?.actionability.summary).toContain("entry is not clean");
  });

  it("downgrades a bullish weekly call when the business backdrop is strained", () => {
    const evidence = buildSimpleAnalysisEvidence(createStrainedInput());
    const thesis = buildStockThesis(
      {
        signal: "BUY",
        cycle: "MARKUP",
        cycleTimeframe: "SHORT",
        confidence: 72,
        riskLevel: "HIGH",
        weeklyTrend: "uptrend",
        pullbackTo21EMA: true,
        keyBearishFactors: ["Debt is still high"],
        earningsEstimateDelta30dPct: -9,
        revisionBalance30d: -3,
        daysToEarnings: 3,
        earningsEventRisk: "imminent",
      },
      evidence,
      { hasExtremeRisk: true },
    );

    expect(thesis).not.toBeNull();
    expect(thesis).toMatchObject({
      title: "Size small or stay away",
      ownability: { value: "Avoid" },
      survivability: { value: "Fragile" },
      alignment: { value: "Tactical" },
    });
    expect(thesis?.confidence.adjusted).toBeLessThan(thesis?.confidence.base ?? 100);
    expect(thesis?.limits.join(" ")).toContain("tactical");
  });

  it("keeps a good business but marks the week as defensive on a sell signal", () => {
    const evidence = buildSimpleAnalysisEvidence(createSupportiveInput());
    const thesis = buildStockThesis(
      {
        signal: "SELL",
        cycle: "DISTRIBUTION",
        cycleTimeframe: "SHORT",
        confidence: 63,
        riskLevel: "MEDIUM",
        weeklyTrend: "downtrend",
        earningsEstimateDelta30dPct: 2,
        revisionBalance30d: 0,
        daysToEarnings: 25,
        earningsEventRisk: "clear",
      },
      evidence,
    );

    expect(thesis).not.toBeNull();
    expect(thesis).toMatchObject({
      title: "Good business, weak entry window",
      ownability: { value: "Own" },
      actionability: { value: "Trim / avoid" },
      alignment: { value: "Timing-only" },
    });
  });

  it("turns a buy into wait mode when earnings are too close and revisions are falling", () => {
    const evidence = buildSimpleAnalysisEvidence(createSupportiveInput());
    const thesis = buildStockThesis(
      {
        signal: "BUY",
        cycle: "MARKUP",
        cycleTimeframe: "SHORT",
        confidence: 68,
        riskLevel: "LOW",
        weeklyTrend: "uptrend",
        pullbackTo21EMA: true,
        daysToEarnings: 4,
        earningsEventRisk: "imminent",
        earningsEstimateDelta30dPct: -8,
        revisionBalance30d: -3,
      },
      evidence,
    );

    expect(thesis).not.toBeNull();
    expect(thesis).toMatchObject({
      actionability: { value: "Wait" },
      survivability: { value: "Fragile" },
    });
    expect(thesis?.limits.join(" ")).toContain("earnings event");
  });

  it("grounds an AI thesis against strained metrics", () => {
    const evidence = buildSimpleAnalysisEvidence(createStrainedInput());
    const thesis = parseAIStockThesis(
      {
        title: "BAD has a clean breakout and deserves aggressive exposure",
        summary: "The setup and business both look excellent.",
        tone: "supportive",
        confidence: 88,
        ownability: {
          value: "Own",
          tone: "supportive",
          summary: "Own it because momentum is strong.",
        },
        actionability: {
          value: "Buy now",
          tone: "supportive",
          summary: "The entry is immediate.",
        },
        survivability: {
          value: "Safe",
          tone: "supportive",
          summary: "Risk is low.",
        },
        alignment: {
          value: "Aligned",
          tone: "supportive",
          summary: "Every horizon agrees.",
        },
        support: ["Momentum is improving"],
        limits: [],
      },
      72,
      {
        evidence,
        weekly: {
          signal: "BUY",
          cycle: "MARKUP",
          cycleTimeframe: "SHORT",
          confidence: 72,
          riskLevel: "HIGH",
          weeklyTrend: "uptrend",
          earningsEventRisk: "imminent",
          earningsEstimateDelta30dPct: -9,
          revisionBalance30d: -3,
        },
        hasExtremeRisk: true,
      },
    );

    expect(thesis).not.toBeNull();
    expect(thesis?.tone).toBe("cautious");
    expect(thesis?.ownability.value).toBe("Avoid");
    expect(thesis?.survivability.value).toBe("Fragile");
    expect(thesis?.confidence.adjusted).toBeLessThan(72);
    expect(thesis?.limits.join(" ")).toContain("smaller size");
  });

  it("parses a persisted thesis snapshot", () => {
    const thesis = buildStockThesis(
      {
        signal: "BUY",
        cycle: "MARKUP",
        cycleTimeframe: "MEDIUM",
        confidence: 74,
        riskLevel: "LOW",
        weeklyTrend: "uptrend",
      },
      buildSimpleAnalysisEvidence(createSupportiveInput()),
    );

    const parsed = parseStockThesis(JSON.stringify(thesis));
    expect(parsed?.version).toBe(STOCK_THESIS_VERSION);
    expect(parsed?.title).toBe(thesis?.title);
    expect(parsed?.ownability.value).toBe(thesis?.ownability.value);
  });

  it("computes thesis diffs between runs", () => {
    const previous = buildStockThesis(
      {
        signal: "BUY",
        cycle: "MARKUP",
        cycleTimeframe: "MEDIUM",
        confidence: 78,
        riskLevel: "LOW",
        weeklyTrend: "uptrend",
      },
      buildSimpleAnalysisEvidence(createSupportiveInput()),
    );

    const current = buildStockThesis(
      {
        signal: "SELL",
        cycle: "DISTRIBUTION",
        cycleTimeframe: "SHORT",
        confidence: 61,
        riskLevel: "MEDIUM",
        weeklyTrend: "downtrend",
      },
      buildSimpleAnalysisEvidence(createSupportiveInput()),
    );

    const changes = diffStockThesis(current, previous);
    expect(changes.some((change) => change.field === "actionability")).toBe(true);
    expect(changes.some((change) => change.field === "alignment")).toBe(true);
    expect(changes.some((change) => change.field === "conviction")).toBe(true);
    expect(stockThesisChangeTone(changes.find((change) => change.field === "actionability")!)).toBe(
      "negative",
    );
    expect(stockThesisChangesTone(changes)).toBe("negative");
  });
});
