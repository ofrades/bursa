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
    if (!data.symbols.length) return [];
    const { getDb } = await import("../lib/db");
    const { refreshStockMetrics } = await import("../lib/metrics");
    const db = await getDb();
    const existing = await db
      .select()
      .from(stockMetrics)
      .where(inArray(stockMetrics.symbol, data.symbols));
    const existingBySymbol = new Map(existing.map((m) => [m.symbol, m]));
    const staleOrMissing = data.symbols.filter((symbol) => {
      const row = existingBySymbol.get(symbol);
      return !row || row.perfDay == null || row.perfWtd == null || row.perfMtd == null;
    });
    if (staleOrMissing.length) {
      await Promise.allSettled(staleOrMissing.map((s) => refreshStockMetrics(s)));
    }
    return db.select().from(stockMetrics).where(inArray(stockMetrics.symbol, data.symbols));
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

export const getStockPageData = createServerFn({ method: "GET" })
  .inputValidator((data: { symbol: string }) => data)
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
        .orderBy(desc(stockAnalysis.weekStart), desc(stockAnalysis.updatedAt))
        .limit(6),
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
