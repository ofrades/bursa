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
    // Old `charts-grid` and `stats-grid` are no longer rendered — the new
    // sections (kpi-grid, quarterly-row, balance-sheet-strip) cover them.
    expect(spec.elements.root.children).not.toContain("charts-grid");
    expect(spec.elements.root.children).not.toContain("stats-grid");
    expect(spec.elements.root.children).not.toContain("verdict");
    expect(spec.elements["context-card"]).toEqual({
      type: "ContextCard",
      props: {
        title: "Business backdrop",
        summary: "Sales, cash, margins, dilution, balance sheet, and valuation.",
      },
    });
  });
});

describe("simple analysis quarterly KPIs & growth chart", () => {
  function inputWithQuarterly(): SimpleAnalysisInputs {
    // 5 quarters of monotonically increasing revenue + net income.
    const q = [
      { label: "Q1 2025", date: "2025-03-31", value: 90_000_000 },
      { label: "Q2 2025", date: "2025-06-30", value: 100_000_000 },
      { label: "Q3 2025", date: "2025-09-30", value: 110_000_000 },
      { label: "Q4 2025", date: "2025-12-31", value: 121_000_000 },
      { label: "Q1 2026", date: "2026-03-31", value: 133_000_000 },
    ];
    const ni = [
      { label: "Q1 2025", date: "2025-03-31", value: 9_000_000 },
      { label: "Q2 2025", date: "2025-06-30", value: 11_000_000 },
      { label: "Q3 2025", date: "2025-09-30", value: 12_000_000 },
      { label: "Q4 2025", date: "2025-12-31", value: 14_000_000 },
      { label: "Q1 2026", date: "2026-03-31", value: 16_000_000 },
    ];
    return createInput({
      quarterlySales: q,
      quarterlyNetIncome: ni,
      // No quarterly FCF — should fall back to annual cashHistory and the
      // cadence label should be "annual".
      quarterlyFcf: [],
    });
  }

  it("populates KPI tiles for revenue and net income", () => {
    const evidence = buildSimpleAnalysisEvidence(inputWithQuarterly());
    expect(evidence).not.toBeNull();
    const tiles = evidence!.kpiTiles ?? [];
    // revenue, netIncome, fcf (annual). Valuation lives in its own card now,
    // not in the growth-pace tiles — see the ValuationCard test below.
    expect(tiles.length).toBe(3);
    const revenue = tiles.find((t) => t.metric === "revenue")!;
    expect(revenue).toBeDefined();
    expect(revenue.metricLabel).toBe("Revenue");
    expect(revenue.cadence).toBe("quarterly");
    // Latest value = 133M, prior = 121M => +9.9% QoQ
    expect(revenue.qoq.value).toBe("+9.9%");
    // YoY: 90M → 133M over 4 quarters = +47.8%
    expect(revenue.yoy.value).toBe("+47.8%");
  });

  it("adds a dedicated ValuationCard (P/E TTM + NTM) with snapshot trend/tone", () => {
    const evidence = buildSimpleAnalysisEvidence(inputWithQuarterly());
    const card = evidence!.valuationCard;
    expect(card).not.toBeNull();
    // Default test input: peRatio=22, forwardPE=20. Forward below trailing
    // means consensus expects growth → "up" trend, neutral tone (22 is in
    // the 15-25 fair-value band).
    expect(card!.ttm).toBe(22);
    expect(card!.ntm).toBe(20);
    expect(card!.ttmLabel).toBe("22.0");
    expect(card!.ntmLabel).toBe("20.0");
    expect(card!.trend).toBe("up");
    expect(card!.tone).toBe("neutral");
  });

  it("omits the ValuationCard when both P/E ratios are missing", () => {
    const base = inputWithQuarterly();
    const evidence = buildSimpleAnalysisEvidence({
      ...base,
      peRatio: null,
      forwardPE: null,
    });
    expect(evidence!.valuationCard).toBeNull();
    // And the growth-pace tiles should not contain a Valuation row.
    expect(evidence!.kpiTiles!.some((t) => t.metricLabel === "Valuation")).toBe(false);
  });

  it("marks FCF as annual when only annual cash history is available", () => {
    const evidence = buildSimpleAnalysisEvidence(inputWithQuarterly());
    const fcf = evidence!.kpiTiles!.find((t) => t.metric === "freeCashFlow")!;
    expect(fcf.cadence).toBe("annual");
  });

  it("produces a quarterly growth chart with revenue + net income series", () => {
    const evidence = buildSimpleAnalysisEvidence(inputWithQuarterly());
    expect(evidence!.quarterlyChart).not.toBeNull();
    expect(evidence!.quarterlyChart!.series.map((s) => s.key)).toEqual(["revenue", "netIncome"]);
  });

  it("produces a CAGR table with 3 / 2 / 1 year horizons", () => {
    const evidence = buildSimpleAnalysisEvidence(inputWithQuarterly());
    expect(evidence!.cagrTable).not.toBeNull();
    expect(evidence!.cagrTable!.horizons.map((h) => h.label)).toEqual(["3 yr", "2 yr", "1 yr"]);
    expect(evidence!.cagrTable!.rows.length).toBe(3);
    const revenue = evidence!.cagrTable!.rows.find((r) => r.metric === "revenue")!;
    // 1-year window for revenue: 90M (Q1 2025) → 133M (Q1 2026), 1 year apart
    // CAGR = (133/90)^(1/1) - 1 ≈ 47.78%
    const oneYear = revenue.cells[2];
    expect(oneYear.horizonLabel).toBe("1 yr");
    expect(oneYear.cagr).toBe("+47.8%");
  });

  it("emits the new top-of-page sections in the spec", () => {
    const evidence = buildSimpleAnalysisEvidence(inputWithQuarterly());
    const spec = buildSimpleAnalysisSpec(evidence!);
    const children = spec.elements.root.children as string[];
    // Order: context-card → kpi-grid → quarterly-row → cagr-table →
    // balance-sheet-strip → takeaways
    expect(children.indexOf("context-card")).toBeLessThan(children.indexOf("kpi-grid"));
    expect(children.indexOf("kpi-grid")).toBeLessThan(children.indexOf("quarterly-row"));
    expect(children.indexOf("quarterly-row")).toBeLessThan(children.indexOf("cagr-table"));
    expect(children.indexOf("cagr-table")).toBeLessThan(children.indexOf("balance-sheet-strip"));
    expect(children.indexOf("balance-sheet-strip")).toBeLessThan(children.indexOf("takeaways"));
    expect(spec.elements["kpi-grid"].type).toBe("KpiGrid");
    // quarterly-row is a GridLayout wrapping the absolute bars + annual YoY.
    expect(spec.elements["quarterly-row"].type).toBe("GridLayout");
    expect(spec.elements["quarterly-row"].children).toEqual([
      "quarterly-chart",
      "annual-growth-chart",
    ]);
    expect(spec.elements["quarterly-chart"].type).toBe("EvidenceChart");
    expect(spec.elements["annual-growth-chart"].type).toBe("EvidenceChart");
    expect(spec.elements["cagr-table"].type).toBe("CagrTable");
    expect(spec.elements["balance-sheet-strip"].type).toBe("BalanceSheetStrip");
  });

  it("emits an annual YoY growth chart with revenue + FCF series", () => {
    const evidence = buildSimpleAnalysisEvidence(inputWithQuarterly());
    expect(evidence!.annualGrowthChart).not.toBeNull();
    // 4 annual data points → 3 YoY rows (we drop the leading row).
    expect(evidence!.annualGrowthChart!.points.length).toBe(3);
    // 1st point = 2023 (YoY vs 2022): sales 1.2B → 1.5B = +25%
    expect(evidence!.annualGrowthChart!.points[0].label).toBe("2023");
    expect(evidence!.annualGrowthChart!.points[0].revenue).toBeCloseTo(25, 1);
  });

  it("emits a 5-entry balance sheet strip", () => {
    const evidence = buildSimpleAnalysisEvidence(inputWithQuarterly());
    expect(evidence!.balanceSheet).toBeDefined();
    expect(evidence!.balanceSheet!.length).toBe(5);
    const keys = evidence!.balanceSheet!.map((e) => e.key);
    expect(keys).toEqual(["profitability", "shareCount", "debtLoad", "debtService", "cashReturn"]);
    // Every entry has a non-empty description (always-visible, per UX rule).
    for (const entry of evidence!.balanceSheet!) {
      expect(entry.description.length).toBeGreaterThan(20);
    }
  });
});
