import { describe, expect, it } from "vitest";
import { buildAnalysisDecision } from "./analysis-decision";

const data = {
  priceVsEMA21: 1,
  priceVsWeeklyEMA21: 2,
  momentum20d: 3,
  earningsEventRisk: "clear",
  relativeStrengthVsMarket20d: 4,
  earningsEstimateDelta90dPct: 5,
};

describe("deterministic setup context", () => {
  it("reports trend and observed metrics without inventing entry advice or confidence", () => {
    const result = buildAnalysisDecision(data);
    expect(result.weeklyTrend).toBe("uptrend");
    expect(result.weeklyCall).toBe("WAIT");
    expect(result.confidence).toBeNull();
    expect(result.keyBullishFactors).toContain("90-day EPS estimate change: 5.0%.");
    expect(result).not.toHaveProperty("priceTarget");
    expect(result).not.toHaveProperty("stopLoss");
  });

  it("does not default missing trend evidence to BUY", () => {
    const result = buildAnalysisDecision({ ...data, priceVsEMA21: null });
    expect(result.signal).toBe("WAIT");
    expect(result.reasoning).toContain("Insufficient price history");
  });

  it("flags imminent earnings without pretending unknown event risk is low", () => {
    expect(buildAnalysisDecision({ ...data, earningsEventRisk: "imminent" }).riskLevel).toBe(
      "HIGH",
    );
    expect(
      buildAnalysisDecision({ ...data, earningsEventRisk: "unknown" }).riskLevel,
    ).toBeUndefined();
  });
});
