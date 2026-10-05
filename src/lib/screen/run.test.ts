import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db";
import { advanceScreen } from "./run";
import { fetchScreenData } from "./fetch";
import type { SymbolData } from "./compute";

vi.mock("./fetch", () => ({
  fetchFxRates: vi.fn().mockResolvedValue({ EUR: 1 }),
  fetchScreenData: vi.fn(),
}));

function createDb() {
  const sqlite = new Database(":memory:");
  for (const folder of [
    "20261005000000_screen",
    "20261005000100_screen_jev",
    "20261005000200_screen_expectations",
    "20261005000300_screen_reliability",
  ]) {
    for (const sql of readFileSync(`drizzle/${folder}/migration.sql`, "utf8").split(
      "--> statement-breakpoint",
    ))
      if (sql.trim()) sqlite.exec(sql);
  }
  const client = drizzle({ client: sqlite });
  const raw: unknown = Object.assign(client, {
    batch: async (queries: { run: () => unknown; toSQL: () => { params: unknown[] } }[]) =>
      sqlite.transaction(() =>
        queries.map((q) => {
          if (q.toSQL().params.length > 100)
            throw new Error("D1 statement exceeds 100 bound parameters");
          return q.run();
        }),
      )(),
  });
  return { sqlite, db: raw as Db };
}

const data: SymbolData = {
  currency: "EUR",
  financialCurrency: "EUR",
  sector: "Technology",
  mcap: 80e9,
  adv: 200e6,
  analysts: 25,
  fy1Rev: 0.1,
  fy2Rev: 0.1,
  upLast30d: 10,
  downLast30d: 2,
  surprises: [],
  mom121: 0.2,
  fwdPe: 15,
  epsGrowthFy1: 0.1,
  statements: {
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
  },
};

afterEach(() => vi.clearAllMocks());

describe("screen run persistence", () => {
  it("claims batches once, persists audits and never restarts a pinned completed run", async () => {
    const { fetchFxRates } = await import("./fetch");
    vi.mocked(fetchFxRates).mockResolvedValue({ EUR: 1 });
    vi.mocked(fetchScreenData).mockResolvedValue({
      name: "Fixture company",
      data,
      issues: ["Freshness unverified"],
      snapshot: {
        source: "Yahoo Finance",
        fetchedAt: new Date().toISOString(),
        fy1: {
          current: 10,
          previous: 9,
          targetDate: "2026-12-31",
          currency: "EUR",
          revision: 0.1,
          epsGrowth: 0.1,
          up30: 10,
          down30: 2,
        },
        fy2: {
          current: 11,
          previous: 10,
          targetDate: "2027-12-31",
          currency: "EUR",
          revision: 0.1,
          epsGrowth: 0.1,
          up30: 10,
          down30: 2,
        },
        statementDate: "2025-12-31",
        priorStatementDate: "2024-12-31",
        priceDate: new Date().toISOString(),
        data,
      },
    });
    const { sqlite, db } = createDb();
    try {
      const results = await Promise.all([advanceScreen(db), advanceScreen(db)]);
      expect(new Set(results.map((r) => r.runId)).size).toBe(1);
      expect(results.reduce((sum, r) => sum + r.batchProcessed, 0)).toBe(10);
      const id = results[0].runId;
      let run = await advanceScreen(db, id);
      while (run.status === "running") run = await advanceScreen(db, id);
      expect(run.status).toBe("done");
      expect(run.processed).toBe(run.universe);
      expect(
        sqlite
          .prepare("SELECT count(*) AS n FROM screen_stock WHERE input_snapshot IS NOT NULL")
          .get(),
      ).toEqual({ n: run.universe });
      await advanceScreen(db, id);
      expect(sqlite.prepare("SELECT count(*) AS n FROM screen_run").get()).toEqual({ n: 1 });
    } finally {
      sqlite.close();
    }
  });

  it("fails a run when every symbol fetch fails", async () => {
    const { fetchFxRates } = await import("./fetch");
    vi.mocked(fetchFxRates).mockResolvedValue({ EUR: 1 });
    vi.mocked(fetchScreenData).mockRejectedValue(new Error("Yahoo unavailable"));
    const { sqlite, db } = createDb();
    try {
      let run = await advanceScreen(db);
      const id = run.runId;
      while (run.status === "running") run = await advanceScreen(db, id);
      expect(run.status).toBe("failed");
      expect(
        sqlite.prepare("SELECT count(*) AS n FROM screen_stock WHERE error IS NOT NULL").get(),
      ).toEqual({ n: run.universe });
    } finally {
      sqlite.close();
    }
  });
});
