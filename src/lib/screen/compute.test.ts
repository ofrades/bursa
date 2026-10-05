import { describe, expect, it } from "vitest";
import {
  advFromBars,
  computeNdEbitda,
  computePiotroski,
  computeRoic,
  computeSue,
  evaluateSymbol,
  finalize,
  momentumFromCloses,
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
    capitalExpenditure: 20,
    sharesOutstanding: [100, 102],
    operatingCashFlow: 120,
    ...overrides,
  };
}

function symbolData(
  overrides: Partial<SymbolData> = {},
  statementOverrides: Partial<Statements> = {},
): SymbolData {
  return {
    currency: "EUR",
    financialCurrency: "EUR",
    sector: "Technology",
    mcap: 80e9,
    adv: 250e6,
    analysts: 25,
    fy1Rev: 0.1,
    fy2Rev: 0.05,
    upLast30d: 10,
    downLast30d: 2,
    surprises: [0.05, 0.04, 0.06, 0.03, 0.02, 0.05, 0.04, 0.03],
    statements: statements(statementOverrides),
    mom121: 0.2,
    fwdPe: 15,
    epsGrowthFy1: 0.1,
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

  it("uses EBITDA, not EBIT, in the leverage gate", () => {
    const row = evaluateSymbol(
      { symbol: "X", name: "X", region: "EU", country: "DE" },
      symbolData({}, { totalDebt: 500, cash: 0, ebit: 100, depreciation: 100 }),
      FX,
      DEFAULT_PARAMS,
    );
    expect(row.ndEbitda).toBe(2.5);
  });

  it("uses actual analyst breadth and rejects unavailable counts", () => {
    const meta = { symbol: "X", name: "X", region: "EU", country: "DE" };
    const row = evaluateSymbol(
      meta,
      symbolData({ upLast30d: 2, downLast30d: 10 }),
      FX,
      DEFAULT_PARAMS,
    );
    expect(row.breadth).toBeCloseTo(-2 / 3);
    expect(row.passRevision).toBe(false);
    expect(
      evaluateSymbol(meta, symbolData({ upLast30d: null }), FX, DEFAULT_PARAMS).breadth,
    ).toBeNull();
  });

  it("enforces the configured SUE history", () => {
    const meta = { symbol: "X", name: "X", region: "EU", country: "DE" };
    expect(
      evaluateSymbol(meta, symbolData({ surprises: [0.1, 0.2, 0.3, 0.4] }), FX, DEFAULT_PARAMS).sue,
    ).toBeNull();
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
    expect(row.breadth).toBeCloseTo(2 / 3);
  });
});

describe("advFromBars", () => {
  it("includes known zero-volume sessions in daily liquidity", () => {
    expect(
      advFromBars([
        { close: 10, volume: 100 },
        { close: 20, volume: 0 }, // known zero trading contributes zero
        { close: 30, volume: null },
        { close: 20, volume: 100 },
      ]),
    ).toBeCloseTo(1000, 0);
  });

  it("returns zero with known zero trading and null with unknown volume", () => {
    expect(advFromBars([{ close: 10, volume: 0 }])).toBe(0);
    expect(advFromBars([{ close: 10, volume: null }])).toBeNull();
  });
});

describe("momentumFromCloses", () => {
  const series = Array.from({ length: 300 }, (_, i) => 100 + i); // 100..399

  it("skips the last month and uses the 12-month-ago close", () => {
    // Endpoints: one month ago (378) and twelve months ago (147).
    const m = momentumFromCloses(series, 252, 21);
    expect(m).toBeCloseTo(378 / 147 - 1, 6);
  });

  it("returns null when history is too short", () => {
    expect(momentumFromCloses(series.slice(0, 250), 252, 21)).toBeNull();
  });

  it("rejects gaps rather than shifting the session window", () => {
    const withNulls = series.map((v, i) => (i === 5 ? null : v));
    expect(momentumFromCloses(withNulls, 252, 21)).toBeNull();
  });

  it("requires an extra close for the starting endpoint", () => {
    expect(momentumFromCloses(series.slice(0, 252), 252, 21)).toBeNull();
    expect(momentumFromCloses(series.slice(0, 253), 252, 21)).toBeTypeOf("number");
  });
});

describe("expectations overlay", () => {
  // FCF = 120 - 20 = 100; yield vs mcap 2_000 -> 5%; conversion 100/67.5 = 148%;
  // fwd ROE = (67.5/300)*1.10 = 24.8%; growth 10% inside the 8-15% band.
  function garpRow(overrides: Partial<SymbolData>, stmtOverrides: Partial<Statements> = {}) {
    return evaluateSymbol(
      { symbol: "G", name: "G", region: "US", country: "US" },
      symbolData({ mcap: 2000, ...overrides }, { ...stmtOverrides }),
      FX,
      DEFAULT_PARAMS,
    );
  }

  it("passes a name in the growth band with ROE, yield and conversion above floors", () => {
    expect(garpRow({}, { stockholdersEquity: 300 }).passExpectations).toBe(true);
  });

  it("fails above the growth ceiling (peak-cycle pricing)", () => {
    expect(garpRow({ epsGrowthFy1: 0.5 }).passExpectations).toBe(false);
  });

  it("fails below the growth floor", () => {
    expect(garpRow({ epsGrowthFy1: 0.05 }).passExpectations).toBe(false);
  });

  it("fails below the forward-ROE floor", () => {
    expect(garpRow({ statements: statements({ stockholdersEquity: 3000 }) }).passExpectations).toBe(
      false,
    );
  });

  it("fails below the FCF yield floor", () => {
    expect(garpRow({ mcap: 5000 }).passExpectations).toBe(false);
  });

  it("fails when FCF does not convert", () => {
    expect(garpRow({ statements: statements({ capitalExpenditure: 200 }) }).passExpectations).toBe(
      false,
    );
  });

  it("exempts financials from FCF gates but keeps the ROE gate", () => {
    const ok = garpRow(
      { sector: "Financial Services", mcap: 5000 },
      { capitalExpenditure: 200, stockholdersEquity: 300 },
    );
    expect(ok.passExpectations).toBe(true);
  });

  it("fails when expectations are not computable", () => {
    expect(garpRow({ epsGrowthFy1: null }).passExpectations).toBe(false);
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

  it("handles an empty survivor set", () => {
    expect(() => finalize([], DEFAULT_PARAMS)).not.toThrow();
  });

  it("uses the configured momentum weight", () => {
    const rows = [row("A", 0.1, 0.1), row("B", 0.1, 0.8)];
    finalize(rows, {
      ...DEFAULT_PARAMS,
      weights: { revision: 0, breadth: 0, sue: 0, momentum: 1 },
    });
    expect(rows[0].composite).toBeCloseTo(-1);
    expect(rows[1].composite).toBeCloseTo(1);
  });

  it("gives zero composite spread when all factors are identical", () => {
    const rows = [row("A", 0.1, 0.2), row("B", 0.1, 0.2), row("C", 0.1, 0.2)];
    finalize(rows, DEFAULT_PARAMS);
    expect(new Set(rows.map((r) => r.composite))).toHaveProperty("size", 1);
  });
});
