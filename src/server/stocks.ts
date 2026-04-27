import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray, desc } from "drizzle-orm";
import {
  stock,
  stockMetrics,
  stockAnalysis,
  dailySignal,
  supervisorAlert,
  watchlist,
} from "../lib/schema";
import { buildSimpleAnalysisEvidence } from "../lib/simple-analysis";
import { authMiddleware } from "./middleware";

// ─── Ensure stock exists in catalog ──────────────────────────────────────────
// Called when a user adds a stock — creates the global record if not yet there.

async function upsertStock(
  db: Awaited<ReturnType<typeof import("../lib/db").getDb>>,
  params: { symbol: string; name?: string; exchange?: string },
) {
  await db
    .insert(stock)
    .values({
      symbol: params.symbol,
      name: params.name,
      exchange: params.exchange,
    })
    .onConflictDoNothing();
}

async function upsertUserStockState(
  db: Awaited<ReturnType<typeof import("../lib/db").getDb>>,
  userId: string,
  params: {
    symbol: string;
    name?: string;
    exchange?: string;
    isSaved: boolean;
    isWatching: boolean;
  },
) {
  await upsertStock(db, params);

  const existing = await db
    .select({ id: watchlist.id })
    .from(watchlist)
    .where(and(eq(watchlist.userId, userId), eq(watchlist.symbol, params.symbol)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(watchlist)
      .set({ isSaved: params.isSaved, isWatching: params.isWatching })
      .where(eq(watchlist.id, existing[0].id));
    return;
  }

  await db.insert(watchlist).values({
    userId,
    symbol: params.symbol,
    isSaved: params.isSaved,
    isWatching: params.isWatching,
  });
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export const getMultipleMetrics = createServerFn({ method: "GET" })
  .inputValidator((data: { symbols: string[] }) => data)
  .handler(async ({ data }) => {
    const symbols = Array.from(new Set(data.symbols.filter(Boolean)));
    if (!symbols.length) return [];

    const { getDb } = await import("../lib/db");
    const { refreshStockMetrics } = await import("../lib/metrics");
    const db = await getDb();

    // Keep table day/week/month metrics fresh on every load. We still tolerate
    // individual provider failures and fall back to the last persisted values.
    await Promise.allSettled(symbols.map((symbol) => refreshStockMetrics(symbol)));

    return db.select().from(stockMetrics).where(inArray(stockMetrics.symbol, symbols));
  });

// ─── Analysis (global — shared across all users) ─────────────────────────────

export const getMultipleAnalyses = createServerFn({ method: "GET" })
  .inputValidator((data: { symbols: string[] }) => data)
  .handler(async ({ data }) => {
    if (!data.symbols.length) return [];
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    const rows = await db
      .select()
      .from(stockAnalysis)
      .where(inArray(stockAnalysis.symbol, data.symbols));
    // Return the most recent analysis per symbol
    const latest = new Map<string, (typeof rows)[0]>();
    for (const row of rows) {
      const cur = latest.get(row.symbol);
      if (!cur || row.weekStart > cur.weekStart) latest.set(row.symbol, row);
    }
    return Array.from(latest.values());
  });

export const getDailySignals = createServerFn({ method: "GET" })
  .inputValidator((data: { stockAnalysisId: string }) => data)
  .handler(async ({ data }) => {
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    return db
      .select()
      .from(dailySignal)
      .where(eq(dailySignal.stockAnalysisId, data.stockAnalysisId));
  });

function yearLabel(value: Date | string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : `${date.getUTCFullYear()}`;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function findClosestPriceOnOrBefore(
  history: Array<{ date: Date; close: number | null }>,
  targetDate: string,
): number | null {
  const target = new Date(targetDate).getTime();
  if (Number.isNaN(target)) return null;

  let candidate: number | null = null;
  for (const point of history) {
    if (point.close == null) continue;
    if (point.date.getTime() <= target) {
      candidate = point.close;
      continue;
    }
    break;
  }

  return candidate;
}

export async function getSimpleAnalysisForSymbol(symbol: string) {
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yf = new YahooFinance({
    suppressNotices: ["ripHistorical", "yahooSurvey"],
  });

  const period1 = new Date();
  period1.setUTCFullYear(period1.getUTCFullYear() - 6);
  period1.setUTCMonth(0, 1);
  period1.setUTCHours(0, 0, 0, 0);

  const [quote, summary, financialsRaw, cashFlowRaw, historicalRaw] = await Promise.all([
    yf.quote(symbol),
    yf.quoteSummary(symbol, {
      modules: ["financialData", "defaultKeyStatistics"],
    }),
    yf.fundamentalsTimeSeries(symbol, {
      period1,
      period2: new Date(),
      type: "annual",
      module: "financials",
    }),
    yf.fundamentalsTimeSeries(symbol, {
      period1,
      period2: new Date(),
      type: "annual",
      module: "cash-flow",
    }),
    yf.historical(symbol, {
      period1,
      period2: new Date(),
      interval: "1mo",
    }),
  ]);

  const financials = Array.isArray(financialsRaw) ? financialsRaw : [];
  const cashFlow = Array.isArray(cashFlowRaw) ? cashFlowRaw : [];
  const historical = Array.isArray(historicalRaw)
    ? historicalRaw
        .filter((point: any) => point?.date && point?.close != null)
        .map((point: any) => ({ date: new Date(point.date), close: asNumber(point.close) }))
        .sort((a, b) => a.date.getTime() - b.date.getTime())
    : [];

  const salesHistory = financials
    .filter((row: any) => row?.date)
    .map((row: any) => {
      const date = new Date(row.date).toISOString();
      return {
        label: yearLabel(date),
        date,
        value: asNumber(row.totalRevenue),
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const cashHistory = cashFlow
    .filter((row: any) => row?.date)
    .map((row: any) => {
      const date = new Date(row.date).toISOString();
      return {
        label: yearLabel(date),
        date,
        value: asNumber(row.freeCashFlow),
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const shareCountHistory = financials
    .filter((row: any) => row?.date)
    .map((row: any) => {
      const date = new Date(row.date).toISOString();
      return {
        label: yearLabel(date),
        date,
        value: asNumber(row.dilutedAverageShares ?? row.shareIssued ?? row.ordinarySharesNumber),
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const anchors = salesHistory.length ? salesHistory : cashHistory;
  const priceHistory = anchors.map((point) => ({
    label: point.label,
    date: point.date,
    value: findClosestPriceOnOrBefore(historical, point.date),
  }));

  const financialData = (summary as any)?.financialData ?? {};
  const defaultStats = (summary as any)?.defaultKeyStatistics ?? {};

  return buildSimpleAnalysisEvidence({
    symbol,
    salesHistory,
    cashHistory,
    priceHistory,
    shareCountHistory,
    currentPrice: asNumber((quote as any)?.regularMarketPrice),
    marketCap: asNumber((quote as any)?.marketCap),
    totalDebt: asNumber(financialData?.totalDebt),
    totalCash: asNumber(financialData?.totalCash),
    freeCashflow: asNumber(financialData?.freeCashflow),
    profitMargin: asNumber(financialData?.profitMargins),
    revenueGrowth: asNumber(financialData?.revenueGrowth),
    operatingMargin: asNumber(financialData?.operatingMargins),
    grossMargin: asNumber(financialData?.grossMargins),
    returnOnEquity: asNumber(financialData?.returnOnEquity ?? defaultStats?.returnOnEquity),
    returnOnAssets: asNumber(financialData?.returnOnAssets ?? defaultStats?.returnOnAssets),
    earningsGrowth: asNumber(
      financialData?.earningsGrowth ?? defaultStats?.earningsQuarterlyGrowth,
    ),
    peRatio: asNumber((quote as any)?.trailingPE),
    forwardPE: asNumber((quote as any)?.forwardPE),
  });
}

export const getStockPageData = createServerFn({ method: "GET" })
  .inputValidator((data: { symbol: string }) => data)
  .handler(async ({ data }) => {
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    const symbol = data.symbol.toUpperCase();

    const [stockRow, analysisRows, simpleAnalysis, marketContext] = await Promise.all([
      db.select().from(stock).where(eq(stock.symbol, symbol)),
      db
        .select()
        .from(stockAnalysis)
        .where(eq(stockAnalysis.symbol, symbol))
        .orderBy(desc(stockAnalysis.weekStart), desc(stockAnalysis.updatedAt))
        .limit(6),
      getSimpleAnalysisForSymbol(symbol).catch(() => null),
      import("./recommend")
        .then(({ gatherStockData }) => gatherStockData(symbol))
        .catch(() => null),
    ]);

    const latestAnalysis = analysisRows[0] ?? null;
    const dailySignalsForLatest = latestAnalysis
      ? await db
          .select()
          .from(dailySignal)
          .where(eq(dailySignal.stockAnalysisId, latestAnalysis.id))
          .orderBy(desc(dailySignal.date), desc(dailySignal.createdAt))
      : [];

    // Latest supervisor alerts (one per supervisor, from most recent analysis)
    const supervisorAlertsForLatest = latestAnalysis
      ? await db
          .select()
          .from(supervisorAlert)
          .where(eq(supervisorAlert.stockAnalysisId, latestAnalysis.id))
          .orderBy(desc(supervisorAlert.createdAt))
      : [];

    return {
      stock: stockRow[0] ?? null,
      latestAnalysis,
      analysisHistory: analysisRows,
      dailySignals: dailySignalsForLatest,
      supervisorAlerts: supervisorAlertsForLatest,
      simpleAnalysis,
      marketContext,
    };
  });

// Public preview used on landing page — gives visitors a feel for the product.
export const getRecentSharedAnalyses = createServerFn({
  method: "GET",
}).handler(async () => {
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  const rows = await db
    .select({
      symbol: stockAnalysis.symbol,
      signal: stockAnalysis.signal,
      confidence: stockAnalysis.confidence,
      updatedAt: stockAnalysis.updatedAt,
      name: stock.name,
    })
    .from(stockAnalysis)
    .leftJoin(stock, eq(stockAnalysis.symbol, stock.symbol))
    .orderBy(desc(stockAnalysis.weekStart));

  // Keep the latest analysis per symbol
  const latest = new Map<
    string,
    {
      symbol: string;
      signal: string;
      confidence: number | null;
      updatedAt: Date | null;
      name: string | null;
    }
  >();
  for (const row of rows) {
    if (!latest.has(row.symbol)) latest.set(row.symbol, row);
  }
  return Array.from(latest.values());
});

// ─── User stock states ───────────────────────────────────────────────────────

export const getTrackedStocks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const ctx = (context ?? {}) as { session: { sub: string } | null };
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    const { session } = ctx;
    if (!session) throw new Error("Unauthorized");

    return db
      .select({
        symbol: watchlist.symbol,
        name: stock.name,
        exchange: stock.exchange,
        isSaved: watchlist.isSaved,
        isWatching: watchlist.isWatching,
      })
      .from(watchlist)
      .leftJoin(stock, eq(watchlist.symbol, stock.symbol))
      .where(eq(watchlist.userId, session.sub));
  });

export const saveStock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { symbol: string; name?: string; exchange?: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = (context ?? {}) as { session: { sub: string } | null };
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    const { session } = ctx;
    if (!session) throw new Error("Unauthorized");
    await upsertUserStockState(db, session.sub, { ...data, isSaved: true, isWatching: false });
    return { ok: true };
  });

export const unsaveStock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { symbol: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = (context ?? {}) as { session: { sub: string } | null };
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    const { session } = ctx;
    if (!session) throw new Error("Unauthorized");
    await db
      .delete(watchlist)
      .where(and(eq(watchlist.userId, session.sub), eq(watchlist.symbol, data.symbol)));
    return { ok: true };
  });

export const watchStock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { symbol: string; name?: string; exchange?: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = (context ?? {}) as { session: { sub: string } | null };
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    const { session } = ctx;
    if (!session) throw new Error("Unauthorized");
    await upsertUserStockState(db, session.sub, { ...data, isSaved: true, isWatching: true });
    return { ok: true };
  });

export const unwatchStock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { symbol: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = (context ?? {}) as { session: { sub: string } | null };
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    const { session } = ctx;
    if (!session) throw new Error("Unauthorized");
    await db
      .update(watchlist)
      .set({ isSaved: true, isWatching: false })
      .where(and(eq(watchlist.userId, session.sub), eq(watchlist.symbol, data.symbol)));
    return { ok: true };
  });
