import { describe, expect, it } from "vitest";

import { buildSimpleAnalysisSpec } from "./simple-analysis-spec";
import { buildSimpleAnalysisEvidence, type SimpleAnalysisInputs } from "./simple-analysis";

function createInput(overrides: Partial<SimpleAnalysisInputs> = {}): SimpleAnalysisInputs {
  return {
    symbol: "ATS.VI",
    salesHistory: [
      { label: "2022", date: "2022-12-31", value: 1_200_000_000 },
      { label: "2023", date: "2023-12-31", value: 1_500_000_000 },
      { label: "2024", date: "2024-12-31", value: 1_300_000_000 },
      { label: "2025", date: "2025-12-31", value: 1_350_000_000 },
    ],
    cashHistory: [
      { label: "2022", date: "2022-12-31", value: 200_000_000 },
      { label: "2023", date: "2023-12-31", value: -400_000_000 },
      { label: "2024", date: "2024-12-31", value: -150_000_000 },
      { label: "2025", date: "2025-12-31", value: -140_000_000 },
    ],
    priceHistory: [
      { label: "2022", date: "2022-12-31", value: 40 },
      { label: "2023", date: "2023-12-31", value: 20 },
      { label: "2024", date: "2024-12-31", value: 33 },
      { label: "2025", date: "2025-12-31", value: 28 },
    ],
    shareCountHistory: [
      { label: "2022", date: "2022-12-31", value: 100_000_000 },
      { label: "2023", date: "2023-12-31", value: 102_000_000 },
      { label: "2024", date: "2024-12-31", value: 103_000_000 },
      { label: "2025", date: "2025-12-31", value: 104_000_000 },
    ],
    currentPrice: 28,
    marketCap: 1_400_000_000,
    totalDebt: 500_000_000,
    totalCash: 200_000_000,
    freeCashflow: 140_000_000,
    ebitda: 220_000_000,
    operatingCashflow: 180_000_000,
    currentRatio: 1.3,
    quickRatio: 1.1,
    profitMargin: 0.085,
    revenueGrowth: 0.03,
    operatingMargin: 0.11,
    grossMargin: 0.33,
    returnOnEquity: 0.14,
    returnOnAssets: 0.05,
    earningsGrowth: 0.04,
    peRatio: 22,
    forwardPE: 20,
    ...overrides,
  };
}

describe("simple analysis context framing", () => {
  it("returns supporting-context copy instead of a second verdict", () => {
    const evidence = buildSimpleAnalysisEvidence(createInput());

    expect(evidence).not.toBeNull();
    expect(evidence).toMatchObject({
      title: "Business backdrop",
    });
    expect(evidence?.summary).toBe("Sales, cash, margins, dilution, balance sheet, and valuation.");
    expect(evidence && "headline" in evidence).toBe(false);
    expect(evidence && "status" in evidence).toBe(false);
  });

  it("builds a context card rather than a verdict card in the rendered spec", () => {
    const evidence = buildSimpleAnalysisEvidence(createInput());
    expect(evidence).not.toBeNull();

    const spec = buildSimpleAnalysisSpec(evidence!);

    expect(spec.elements.root.children).toContain("context-card");
    expect(spec.elements.root.children).toContain("charts-grid");
    expect(spec.elements.root.children).not.toContain("verdict");
    expect(spec.elements["context-card"]).toEqual({
      type: "ContextCard",
      props: {
        title: "Business backdrop",
        summary: "Sales, cash, margins, dilution, balance sheet, and valuation.",
      },
    });
    expect(spec.elements["charts-grid"]).toEqual({
      type: "GridLayout",
      props: { columns: 3 },
      children: ["chart-0", "chart-1", "chart-2"],
    });
  });
});
