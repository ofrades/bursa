import { describe, expect, it } from "vitest";
import {
  computeNdEbitda,
  computePiotroski,
  computeRoic,
  computeSue,
  evaluateSymbol,
  finalize,
  DEFAULT_PARAMS,
  type Statements,
  type SymbolData,
} from "./compute";

function statements(overrides: Partial<Statements> = {}): Statements {
  return {
    ebit: 200,
    depreciation: 10,
    pretaxIncome: 90,
    taxProvision: 22.5,
    netIncome: [67.5, 60],
    totalRevenue: [1000, 900],
    grossProfit: [400, 350],
    totalAssets: [2000, 1900],
    currentAssets: [800, 750],
    currentLiabilities: [400, 420],
    totalDebt: 300,
    longTermDebt: [200, 220],
    stockholdersEquity: 1000,
    cash: 100,
    shortTermInvestments: 50,
    sharesOutstanding: [100, 102],
    operatingCashFlow: 120,
    ...overrides,
  };
}

function symbolData(overrides: Partial<SymbolData> = {}): SymbolData {
  return {
    currency: "EUR",
    sector: "Technology",
    mcap: 80e9,
    adv: 250e6,
    analysts: 25,
    fy1Rev: 0.1,
    fy2Rev: 0.05,
    upLast30d: null,
    downLast30d: null,
    surprises: [0.05, 0.04, 0.06, 0.03, 0.02, 0.05, 0.04, 0.03],
    statements: statements(),
    mom121: 0.2,
    fwdPe: 15,
    ...overrides,
  };
}

const FX = { EUR: 1, USD: 1.16, DKK: 7.4746, GBP: 0.8493 };

describe("computeSue", () => {
  it("returns null under 3 quarters", () => {
    expect(computeSue([0.1, 0.2])).toBeNull();
  });

  it("is mean(last 4) over std(last 8)", () => {
    // mean4 = 0.045, mean8 = 0.04, sd8 = 0.013093 -> 3.4369
    expect(computeSue([0.05, 0.04, 0.06, 0.03, 0.02, 0.05, 0.04, 0.03])).toBeCloseTo(3.4369, 3);
  });

  it("caps at +-3 on zero variance", () => {
    expect(computeSue([0.05, 0.05, 0.05])).toBe(3);
    expect(computeSue([-0.05, -0.05, -0.05])).toBe(-3);
  });
});

describe("computeRoic", () => {
  it("computes NOPAT over invested capital", () => {
    // tax 22.5/90 = 25%; NOPAT = 150; IC = 300 + 1000 - 150 = 1150
    expect(computeRoic(statements())).toBeCloseTo(0.1304, 3);
  });

  it("clamps extreme tax rates", () => {
    const roic = computeRoic(statements({ taxProvision: -50, pretaxIncome: 90 }));
    expect(roic).toBeCloseTo(200 / 1150, 4);
  });

  it("returns null on negative invested capital", () => {
    expect(
      computeRoic(statements({ totalDebt: 100, stockholdersEquity: 100, cash: 500 })),
    ).toBeNull();
  });
});

describe("computeNdEbitda", () => {
  it("prefers reported figures", () => {
    expect(computeNdEbitda(300, 100, 200, statements())).toBeCloseTo(1, 3);
  });

  it("falls back to EBIT + D&A", () => {
    expect(computeNdEbitda(300, 100, null, statements())).toBeCloseTo(0.9524, 3);
  });

  it("returns null without ebitda and depreciation", () => {
    expect(computeNdEbitda(500, 150, null, statements({ depreciation: null }))).toBeNull();
  });
});

describe("computePiotroski", () => {
  it("scores a healthy improver 9/9", () => {
    expect(computePiotroski(statements())).toBe(9);
  });

  it("penalizes deteriorating fundamentals", () => {
    const s = statements({
      netIncome: [-10, 60],
      operatingCashFlow: -5,
      longTermDebt: [400, 300],
      sharesOutstanding: [110, 100],
      grossProfit: [300, 350],
    });
    expect(computePiotroski(s)).toBeLessThan(5);
  });

  it("returns null with missing statements", () => {
    expect(computePiotroski(statements({ grossProfit: [null, null] }))).toBeNull();
  });
});

describe("evaluateSymbol", () => {
  it("converts listing currency to EUR (DKK)", () => {
    const row = evaluateSymbol(
      { symbol: "NOVO-B.CO", name: "Novo Nordisk", region: "EU", country: "DK" },
      symbolData({ currency: "DKK", mcap: 1.0984e12, adv: 1.334e9 }),
      FX,
      DEFAULT_PARAMS,
    );
    expect(row.mcapEur).toBeCloseTo(146.9, 0);
    expect(row.advEur).toBeCloseTo(178.4, 0);
  });

  it("divides GBp ADV by 100 but not market cap", () => {
    const row = evaluateSymbol(
      { symbol: "AZN.L", name: "AstraZeneca", region: "EU", country: "GB" },
      symbolData({ currency: "GBp", mcap: 184.1e9, adv: 42.17e9 }),
      FX,
      DEFAULT_PARAMS,
    );
    expect(row.mcapEur).toBeCloseTo(216.8, 0);
    expect(row.advEur).toBeCloseTo(496.6, 0);
  });

  it("exempts financials from roic/leverage but not revision gates", () => {
    const row = evaluateSymbol(
      { symbol: "GS", name: "Goldman", region: "US", country: "US" },
      symbolData({ sector: "Financial Services", statements: statements({ ebit: null }) }),
      FX,
      DEFAULT_PARAMS,
    );
    expect(row.passQuality).toBe(true);
    expect(row.roic).toBeNull();
  });

  it("fails non-financials when roic cannot be computed", () => {
    const row = evaluateSymbol(
      { symbol: "X", name: "X", region: "US", country: "US" },
      symbolData({ statements: statements({ ebit: null }) }),
      FX,
      DEFAULT_PARAMS,
    );
    expect(row.passQuality).toBe(false);
  });

  it("requires both FY1 and FY2 revisions positive", () => {
    const row = evaluateSymbol(
      { symbol: "X", name: "X", region: "US", country: "US" },
      symbolData({ fy1Rev: 0.1, fy2Rev: -0.02 }),
      FX,
      DEFAULT_PARAMS,
    );
    expect(row.passRevision).toBe(false);
    expect(row.breadth).toBe(0);
  });
});

describe("finalize", () => {
  function row(symbol: string, rev: number, mom: number) {
    const r = evaluateSymbol(
      { symbol, name: symbol, region: "US", country: "US" },
      symbolData({ fy1Rev: rev, fy2Rev: rev, mom121: mom }),
      FX,
      DEFAULT_PARAMS,
    );
    return r;
  }

  it("marks the top revision quintile strict and weights all survivors equally", () => {
    const rows = [
      row("A", 0.3, 0.1),
      row("B", 0.2, 0.1),
      row("C", 0.15, 0.1),
      row("D", 0.1, 0.1),
      row("E", 0.05, 0.1),
      row("F", -0.1, 0.1), // fails revision gate
    ];
    finalize(rows, DEFAULT_PARAMS);
    const survivors = rows.filter((r) => r.passRevision);
    expect(survivors).toHaveLength(5);
    expect(rows.filter((r) => r.strict).map((r) => r.symbol)).toEqual(["A"]);
    for (const r of survivors) expect(r.weight).toBeCloseTo(0.2, 6);
    expect(rows[0].composite).toBeGreaterThan(rows[3].composite ?? 0);
  });

  it("gives zero composite spread when all factors are identical", () => {
    const rows = [row("A", 0.1, 0.2), row("B", 0.1, 0.2), row("C", 0.1, 0.2)];
    finalize(rows, DEFAULT_PARAMS);
    expect(new Set(rows.map((r) => r.composite))).toHaveProperty("size", 1);
  });
});
