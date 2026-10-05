import Sqlite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../lib/db";
import { businessJudgmentsSchema } from "../lib/judgments";
import { gatherAnalysisSnapshot, saveAnalysisDecision } from "./recommend";

const mocks = vi.hoisted(() => ({
  quote: vi.fn(),
  summary: vi.fn(),
  prices: vi.fn(),
  simple: vi.fn(),
}));
vi.mock("../lib/market-data", () => ({
  getMarketQuote: mocks.quote,
  getMarketSummary: mocks.summary,
  getHistoricalPrices: mocks.prices,
}));
vi.mock("./stocks", () => ({ getSimpleAnalysisForSymbol: mocks.simple }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.quote.mockResolvedValue({ regularMarketPrice: 100, longName: "Example" });
  mocks.summary.mockResolvedValue({
    earningsTrend: { trend: [{ epsTrend: { current: 1.1, "90daysAgo": 1 } }] },
  });
  mocks.prices.mockResolvedValue(
    Array.from({ length: 180 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, i + 1)),
      close: 99,
    })),
  );
  mocks.simple.mockResolvedValue(null);
});

describe("compact analysis snapshot and persistence", () => {
  it("fetches only the stock and market benchmark, and computes revision changes in code", async () => {
    const snapshot = await gatherAnalysisSnapshot("X");
    expect(mocks.prices).toHaveBeenCalledTimes(2);
    expect(mocks.prices.mock.calls.map(([symbol]) => symbol)).toEqual(["X", "SPY"]);
    expect(snapshot.stockData.earningsEstimateDelta90dPct).toBeCloseTo(10);
    expect(snapshot.stockData.priceVsEMA21).toBeCloseTo((100 / 99) * 100 - 100);
    expect(snapshot).not.toHaveProperty("dividendData");
  });

  it("keeps unavailable prices and zero-baseline revisions unknown", async () => {
    mocks.quote.mockResolvedValue({});
    mocks.summary.mockResolvedValue({
      earningsTrend: { trend: [{ epsTrend: { current: 1, "90daysAgo": 0 } }] },
    });
    const snapshot = await gatherAnalysisSnapshot("X");
    expect(snapshot.stockData.currentPrice).toBeNull();
    expect(snapshot.stockData.priceVsEMA21).toBeNull();
    expect(snapshot.stockData.earningsEstimateDelta90dPct).toBeNull();
  });

  it("persists typed judgments without generated macro prose or a memory table", async () => {
    const sqlite = new Sqlite(":memory:");
    sqlite.exec(`
      CREATE TABLE stock (symbol TEXT PRIMARY KEY, last_analyzed_at INTEGER);
      INSERT INTO stock (symbol) VALUES ('X');
      CREATE TABLE stock_analysis (
        id TEXT PRIMARY KEY, symbol TEXT, analysis_date TEXT, signal TEXT,
        cycle TEXT, cycle_timeframe TEXT, cycle_strength REAL, confidence REAL,
        reasoning TEXT, simple_analysis_json TEXT, thesis_json TEXT, thesis_version TEXT,
        macro_thesis_json TEXT, price_at_analysis REAL, last_triggered_by_user_id TEXT,
        created_at INTEGER, updated_at INTEGER
      );
    `);
    const raw: unknown = drizzle({ client: sqlite });
    const db = raw as Db;
    const answer = {
      type: "choice",
      value: "INSUFFICIENT_EVIDENCE",
      probability: 1,
      confidence: 1,
      probabilities: { INSUFFICIENT_EVIDENCE: 1 },
    };
    const judgments = businessJudgmentsSchema.parse({
      model: "typesafe/jev-1.13-20260917",
      revisionQuality: answer,
      businessMomentum: answer,
      evidence: [],
    });
    try {
      const snapshot = await gatherAnalysisSnapshot("X");
      const id = await saveAnalysisDecision({
        db,
        symbol: "X",
        snapshot,
        judgments,
        userId: "u1",
        analysisDate: "2026-09-30",
      });
      const row = sqlite
        .prepare("SELECT reasoning, confidence, macro_thesis_json FROM stock_analysis WHERE id = ?")
        .get(id) as {
        reasoning: string;
        confidence: number | null;
        macro_thesis_json: string | null;
      };
      expect(JSON.parse(row.reasoning).judgments).toEqual(judgments);
      expect(JSON.parse(row.reasoning).weeklyCall).toBe("WAIT");
      expect(row.confidence).toBeNull();
      expect(row.macro_thesis_json).toBeNull();
      expect(sqlite.prepare("SELECT last_analyzed_at FROM stock WHERE symbol = 'X'").get()).toEqual(
        { last_analyzed_at: expect.any(Number) },
      );
    } finally {
      sqlite.close();
    }
  });
});
