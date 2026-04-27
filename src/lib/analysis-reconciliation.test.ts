import { describe, expect, it } from "vitest";

import { reconcileWeeklyWithFundamentals } from "./analysis-reconciliation";
import { buildSimpleAnalysisEvidence, type SimpleAnalysisInputs } from "./simple-analysis";

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
    currentPrice: 13,
    marketCap: 150,
    totalDebt: 20,
    totalCash: 80,
    freeCashflow: 18,
    profitMargin: 0.18,
    revenueGrowth: 0.12,
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
    currentPrice: 30,
    marketCap: 1200,
    totalDebt: 300,
    totalCash: 50,
    freeCashflow: 10,
    profitMargin: 0.03,
    revenueGrowth: -0.12,
    ...overrides,
  };
}

describe("reconcileWeeklyWithFundamentals", () => {
  it("frames BUY against weak fundamentals as a tactical call", () => {
    const evidence = buildSimpleAnalysisEvidence(createStrainedInput());
    expect(evidence?.posture).toBe("strained");

    const result = reconcileWeeklyWithFundamentals(
      {
        signal: "BUY",
        cycle: "MARKUP",
        cycleTimeframe: "SHORT",
        confidence: 61,
        weeklyTrend: "uptrend",
        pullbackTo21EMA: true,
      },
      evidence!,
    );

    expect(result).toMatchObject({
      tone: "balanced",
      title: "This week's BUY is tactical, not a clean fundamental endorsement.",
    });
    expect(result?.summary).toContain("short-term opportunity");
    expect(result?.bullets.join(" ")).toContain("business still has to earn a stronger long-term case");
  });

  it("frames SELL against supportive fundamentals as a timing call", () => {
    const evidence = buildSimpleAnalysisEvidence(createSupportiveInput());
    expect(evidence?.posture).toBe("supportive");

    const result = reconcileWeeklyWithFundamentals(
      {
        signal: "SELL",
        cycle: "DISTRIBUTION",
        cycleTimeframe: "SHORT",
        confidence: 58,
        weeklyTrend: "downtrend",
      },
      evidence!,
    );

    expect(result).toMatchObject({
      tone: "balanced",
      title: "This week's SELL is about timing, not a verdict that the business is broken.",
    });
    expect(result?.summary).toContain("risk-management call");
  });

  it("shows alignment when weekly BUY and fundamentals both support it", () => {
    const evidence = buildSimpleAnalysisEvidence(createSupportiveInput());

    const result = reconcileWeeklyWithFundamentals(
      {
        signal: "BUY",
        cycle: "MARKUP",
        cycleTimeframe: "MEDIUM",
        confidence: 76,
        weeklyTrend: "uptrend",
        consolidationBreakout21EMA: true,
      },
      evidence!,
    );

    expect(result).toMatchObject({
      tone: "supportive",
      title: "This week's BUY is backed by the broader fundamentals.",
    });
    expect(result?.summary).toContain("pointing in the same general direction");
  });
});
