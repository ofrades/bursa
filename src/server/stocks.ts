import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { and, eq, inArray, desc } from "drizzle-orm";
import { stock, stockMetrics, stockAnalysis, dailySignal, watchlist } from "../lib/schema";
import { buildSimpleAnalysisEvidence, parseSimpleAnalysisEvidence } from "../lib/simple-analysis";
import {
  symbolListInput,
  symbolInputObject,
  stockStateInput,
} from "../lib/validators";
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

const METRICS_STALE_MS = 15 * 60 * 1000;

function uniqueMetricSymbols(symbols: string[]) {
  return Array.from(new Set(symbols.filter(Boolean).map((symbol) => symbol.toUpperCase())));
}

function staleMetricSymbols(
  symbols: string[],
  rows: Array<{ symbol: string; updatedAt: Date }>,
  now = Date.now(),
) {
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  return symbols.filter((symbol) => {
    const row = bySymbol.get(symbol);
    if (!row) return true;
    return now - new Date(row.updatedAt).getTime() >= METRICS_STALE_MS;
  });
}

export const getMultipleMetrics = createServerFn({ method: "GET" })
  .inputValidator((data) => symbolListInput.parse(data))
  .handler(async ({ data }) => {
    const symbols = uniqueMetricSymbols(data.symbols);
    if (!symbols.length) return [];

    const { getDb } = await import("../lib/db");
    const db = await getDb();
    return db.select().from(stockMetrics).where(inArray(stockMetrics.symbol, symbols));
  });

export const refreshMultipleMetrics = createServerFn({ method: "POST" })
  .inputValidator((data) => symbolListInput.parse(data))
  .handler(async ({ data }) => {
    const symbols = uniqueMetricSymbols(data.symbols);
    if (!symbols.length) return [];

    const { getDb } = await import("../lib/db");
    const { refreshStockMetrics } = await import("../lib/metrics");
    const db = await getDb();

    const existing = await db
      .select()
      .from(stockMetrics)
      .where(inArray(stockMetrics.symbol, symbols));
    const toRefresh = staleMetricSymbols(
      symbols,
      existing as Array<{ symbol: string; updatedAt: Date }>,
    );

    if (toRefresh.length) {
      await Promise.allSettled(toRefresh.map((symbol) => refreshStockMetrics(symbol)));
    }

    return db.select().from(stockMetrics).where(inArray(stockMetrics.symbol, symbols));
  });

// ─── Analysis (global — shared across all users) ─────────────────────────────

export const getMultipleAnalyses = createServerFn({ method: "GET" })
  .inputValidator((data) => symbolListInput.parse(data))
  .handler(async ({ data }) => {
    if (!data.symbols.length) return [];
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    const rows = await db
      .select()
      .from(stockAnalysis)
      .where(inArray(stockAnalysis.symbol, data.symbols))
      .orderBy(desc(stockAnalysis.updatedAt), desc(stockAnalysis.createdAt));
    // Return the most recent analysis per symbol
    const latest = new Map<string, (typeof rows)[0]>();
    for (const row of rows) {
      if (!latest.has(row.symbol)) latest.set(row.symbol, row);
    }
    return Array.from(latest.values());
  });

function yearLabel(value: Date | string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : `${date.getUTCFullYear()}`;
}

function quarterLabel(value: Date | string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `Q${q} ${date.getUTCFullYear()}`;
}

const finiteNumberSchema = z.number();

function asNumber(value: number | null | undefined) {
  const result = finiteNumberSchema.safeParse(value);
  return result.success && Number.isFinite(result.data) ? result.data : null;
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
  const {
    getAnnualCashFlowStatements,
    getAnnualFinancialStatements,
    getHistoricalPrices,
    getMarketQuote,
    getMarketSummary,
    getQuarterlyCashFlowStatements,
    getQuarterlyFinancialStatements,
  } = await import("../lib/market-data");

  const period1 = new Date();
  period1.setUTCFullYear(period1.getUTCFullYear() - 6);
  period1.setUTCMonth(0, 1);
  period1.setUTCHours(0, 0, 0, 0);
  const quarterlyPeriod1 = new Date();
  quarterlyPeriod1.setUTCFullYear(quarterlyPeriod1.getUTCFullYear() - 4);
  quarterlyPeriod1.setUTCMonth(0, 1);
  quarterlyPeriod1.setUTCHours(0, 0, 0, 0);
  const period2 = new Date();

  const [
    quote,
    summary,
    financialsRaw,
    cashFlowRaw,
    historicalRaw,
    quarterlyFinancialsRaw,
    quarterlyCashFlowRaw,
  ] = await Promise.all([
    getMarketQuote(symbol),
    getMarketSummary(symbol),
    getAnnualFinancialStatements(symbol, { period1, period2 }),
    getAnnualCashFlowStatements(symbol, { period1, period2 }),
    getHistoricalPrices(symbol, { period1, period2, interval: "1d" }),
    getQuarterlyFinancialStatements(symbol, { period1: quarterlyPeriod1, period2 }),
    getQuarterlyCashFlowStatements(symbol, { period1: quarterlyPeriod1, period2 }),
  ]);

  const financials = Array.isArray(financialsRaw) ? financialsRaw : [];
  const cashFlow = Array.isArray(cashFlowRaw) ? cashFlowRaw : [];
  const quarterlyFinancials = Array.isArray(quarterlyFinancialsRaw) ? quarterlyFinancialsRaw : [];
  const quarterlyCashFlow = Array.isArray(quarterlyCashFlowRaw) ? quarterlyCashFlowRaw : [];
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

  // ── Quarterly histories for the new KPI tiles + growth chart ───────────────
  // Use the latest 16 quarters (≈4y) of revenue, net income, and free cash flow.
  // Missing series (e.g. FCF from Yahoo's sparse cash-flow module) become null
  // tiles in the UI rather than a missing section.
  const quarterlySales = quarterlyFinancials
    .filter((row: any) => row?.date)
    .map((row: any) => {
      const date = new Date(row.date).toISOString();
      return { label: quarterLabel(date), date, value: asNumber(row.totalRevenue) };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-16);

  const quarterlyNetIncome = quarterlyFinancials
    .filter((row: any) => row?.date)
    .map((row: any) => {
      const date = new Date(row.date).toISOString();
      return { label: quarterLabel(date), date, value: asNumber(row.netIncome) };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-16);

  const quarterlyFcf = quarterlyCashFlow
    .filter((row: any) => row?.date)
    .map((row: any) => {
      const date = new Date(row.date).toISOString();
      return { label: quarterLabel(date), date, value: asNumber(row.freeCashFlow) };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-16);

  const financialData = (summary as any)?.financialData ?? {};
  const defaultStats = (summary as any)?.defaultKeyStatistics ?? {};
  const summaryDetail = (summary as any)?.summaryDetail ?? {};
  const priceSummary = (summary as any)?.price ?? {};
  const currentPrice = asNumber(
    (quote as any)?.regularMarketPrice ??
      financialData?.currentPrice ??
      priceSummary?.regularMarketPrice,
  );
  const marketCap = asNumber((quote as any)?.marketCap ?? priceSummary?.marketCap);
  const trailingEps = asNumber(
    (quote as any)?.epsTrailingTwelveMonths ??
      (quote as any)?.trailingEps ??
      defaultStats?.trailingEps,
  );
  const forwardEps = asNumber(
    (quote as any)?.epsForward ?? (quote as any)?.forwardEps ?? defaultStats?.forwardEps,
  );
  const peRatio =
    asNumber((quote as any)?.trailingPE ?? summaryDetail?.trailingPE ?? defaultStats?.trailingPE) ??
    (currentPrice != null && trailingEps != null && trailingEps > 0
      ? currentPrice / trailingEps
      : null);
  const forwardPE =
    asNumber((quote as any)?.forwardPE ?? summaryDetail?.forwardPE ?? defaultStats?.forwardPE) ??
    (currentPrice != null && forwardEps != null && forwardEps > 0
      ? currentPrice / forwardEps
      : null);

  return buildSimpleAnalysisEvidence({
    symbol,
    salesHistory,
    cashHistory,
    priceHistory,
    shareCountHistory,
    quarterlySales,
    quarterlyNetIncome,
    quarterlyFcf,
    currentPrice,
    marketCap,
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
    peRatio,
    forwardPE,
    ebitda: asNumber(financialData?.ebitda),
    operatingCashflow: asNumber(financialData?.operatingCashflow),
    currentRatio: asNumber(financialData?.currentRatio),
    quickRatio: asNumber(financialData?.quickRatio),
  });
}

export const getStockPageData = createServerFn({ method: "GET" })
  .inputValidator((data) => symbolInputObject.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    const symbol = data.symbol.toUpperCase();

    const [stockRow, analysisRows] = await Promise.all([
      db.select().from(stock).where(eq(stock.symbol, symbol)),
      db
        .select()
        .from(stockAnalysis)
        .where(eq(stockAnalysis.symbol, symbol))
        .orderBy(desc(stockAnalysis.updatedAt), desc(stockAnalysis.createdAt))
        .limit(6),
    ]);

    const latestAnalysis = analysisRows[0] ?? null;
    const simpleAnalysis = parseSimpleAnalysisEvidence(latestAnalysis?.simpleAnalysisJson ?? null);
    const dailySignalsForLatest = latestAnalysis
      ? await db
          .select()
          .from(dailySignal)
          .where(eq(dailySignal.stockAnalysisId, latestAnalysis.id))
          .orderBy(desc(dailySignal.date), desc(dailySignal.createdAt))
      : [];

    return {
      stock: stockRow[0] ?? null,
      latestAnalysis,
      analysisHistory: analysisRows,
      dailySignals: dailySignalsForLatest,
      simpleAnalysis,
    };
  });

export const getStockPageSupplementalData = createServerFn({ method: "GET" })
  .inputValidator((data) => symbolInputObject.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    const symbol = data.symbol.toUpperCase();

    const [latestAnalysis] = await db
      .select({ simpleAnalysisJson: stockAnalysis.simpleAnalysisJson })
      .from(stockAnalysis)
      .where(eq(stockAnalysis.symbol, symbol))
      .orderBy(desc(stockAnalysis.updatedAt), desc(stockAnalysis.createdAt))
      .limit(1);

    const persistedSimpleAnalysis = parseSimpleAnalysisEvidence(
      latestAnalysis?.simpleAnalysisJson ?? null,
    );
    if (persistedSimpleAnalysis) {
      return { simpleAnalysis: persistedSimpleAnalysis };
    }

    const simpleAnalysis = await getSimpleAnalysisForSymbol(symbol).catch(() => null);
    return { simpleAnalysis };
  });

export const getStockDividendData = createServerFn({ method: "GET" })
  .inputValidator((data) => symbolInputObject.parse(data))
  .handler(async ({ data }) => {
    const { getDividendData } = await import("../lib/market-data");
    return getDividendData(data.symbol.toUpperCase());
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
      reasoning: stockAnalysis.reasoning,
      thesisJson: stockAnalysis.thesisJson,
      macroThesisJson: stockAnalysis.macroThesisJson,
      name: stock.name,
    })
    .from(stockAnalysis)
    .leftJoin(stock, eq(stockAnalysis.symbol, stock.symbol))
    .orderBy(desc(stockAnalysis.updatedAt), desc(stockAnalysis.createdAt));

  // Keep the latest analysis per symbol
  const latest = new Map<
    string,
    {
      symbol: string;
      signal: string;
      confidence: number | null;
      updatedAt: Date | null;
      reasoning: string | null;
      thesisJson: string | null;
      macroThesisJson: string | null;
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
  .inputValidator((data) => stockStateInput.parse(data))
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
  .inputValidator((data) => symbolInputObject.parse(data))
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
  .inputValidator((data) => stockStateInput.parse(data))
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
  .inputValidator((data) => symbolInputObject.parse(data))
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
