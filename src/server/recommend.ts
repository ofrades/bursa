import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { stockAnalysis, stock } from "../lib/schema";
import { ema } from "../lib/metrics";
import { calculateBilledCost } from "../lib/pricing";
import type { SimpleAnalysisEvidence } from "../lib/simple-analysis";
import type { BusinessJudgments } from "../lib/judgments";
import { buildAnalysisDecision } from "../lib/analysis-decision";
import { buildStockThesis, STOCK_THESIS_VERSION } from "../lib/stock-thesis";

export type AIUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  model: string;
};

async function gatherStockData(symbol: string) {
  const { getHistoricalPrices, getMarketQuote, getMarketSummary } =
    await import("../lib/market-data");
  const period1 = new Date(Date.now() - 260 * 86_400_000);
  const period2 = new Date();
  const [quote, summary, historical, benchmark] = await Promise.all([
    getMarketQuote(symbol),
    getMarketSummary(symbol),
    getHistoricalPrices(symbol, { period1, period2, interval: "1d" }),
    getHistoricalPrices("SPY", { period1, period2, interval: "1d" }),
  ]);
  const prices = historical
    .filter((point) => point.close != null && Number.isFinite(point.close) && point.close > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const closes = prices.map((point) => point.close!);
  const weeks = new Map<number, number>();
  for (const point of prices) {
    const date = new Date(point.date);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    weeks.set(date.getTime(), point.close!);
  }
  const weeklyCloses = Array.from(weeks.values());
  const currentPrice =
    quote.regularMarketPrice != null &&
    Number.isFinite(quote.regularMarketPrice) &&
    quote.regularMarketPrice > 0
      ? quote.regularMarketPrice
      : null;
  const distanceFromEma = (values: number[]) => {
    if (values.length < 21 || currentPrice == null) return null;
    const average = ema(values, 21).at(-1)!;
    return ((currentPrice - average) / average) * 100;
  };
  const benchmarkCloses = benchmark
    .filter((point) => point.close != null && Number.isFinite(point.close) && point.close > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((point) => point.close!);
  const return20d = (values: number[]) =>
    values.length > 20 ? (values.at(-1)! / values.at(-21)! - 1) * 100 : null;
  const stockReturn = return20d(closes);
  const benchmarkReturn = return20d(benchmarkCloses);
  const earningsDate = summary.calendarEvents?.earnings?.earningsDate?.[0];
  const daysToEarnings = earningsDate
    ? Math.ceil((new Date(earningsDate).getTime() - Date.now()) / 86_400_000)
    : null;
  const earningsEventRisk =
    daysToEarnings == null || !Number.isFinite(daysToEarnings)
      ? "unknown"
      : daysToEarnings < 0
        ? "passed"
        : daysToEarnings <= 7
          ? "imminent"
          : daysToEarnings <= 21
            ? "near"
            : "clear";
  const trend = summary.earningsTrend?.trend?.[0]?.epsTrend;
  const current = trend?.current;
  const baseline = trend?.["90daysAgo"];
  const earningsEstimateDelta90dPct =
    current != null &&
    baseline != null &&
    Number.isFinite(current) &&
    Number.isFinite(baseline) &&
    baseline !== 0
      ? ((current - baseline) / Math.abs(baseline)) * 100
      : null;
  return {
    companyName: quote.longName ?? quote.shortName ?? symbol,
    businessSummary: summary.assetProfile?.longBusinessSummary ?? null,
    currentPrice,
    priceVsEMA21: distanceFromEma(closes),
    priceVsWeeklyEMA21: distanceFromEma(weeklyCloses),
    relativeStrengthVsMarket20d:
      stockReturn != null && benchmarkReturn != null ? stockReturn - benchmarkReturn : null,
    earningsEventRisk,
    earningsEstimateDelta90dPct,
    revenueGrowth: summary.financialData?.revenueGrowth ?? null,
    earningsGrowth: summary.financialData?.earningsGrowth ?? null,
  };
}

export type AnalysisRunSnapshot = {
  stockData: Awaited<ReturnType<typeof gatherStockData>>;
  simpleAnalysis: SimpleAnalysisEvidence | null;
};

export async function gatherAnalysisSnapshot(symbol: string): Promise<AnalysisRunSnapshot> {
  const { getSimpleAnalysisForSymbol } = await import("./stocks");
  const [stockData, simpleAnalysis] = await Promise.all([
    gatherStockData(symbol),
    getSimpleAnalysisForSymbol(symbol),
  ]);
  return { stockData, simpleAnalysis };
}

export async function chargeUserForUsage(
  userId: string,
  reservationId: string,
  symbol: string,
  usage: AIUsage,
) {
  const { getD1Database } = await import("../lib/db");
  const { settleAnalysisUsage } = await import("../lib/analysis-reservation");
  const { getUsdToEurRate } = await import("../lib/fx");

  const billing = calculateBilledCost({
    actualModel: usage.model,
    providerCostUsd: usage.costUsd,
    usdToEurRate: await getUsdToEurRate(),
  });
  const settlement = await settleAnalysisUsage(getD1Database(), {
    userId,
    reservationId,
    symbol,
    model: usage.model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    providerCostUsd: usage.costUsd,
    calculatedCents: billing.billedCents,
    usageReported: true,
  });

  return {
    billedCents: settlement.chargedCents,
    calculatedCents: billing.billedCents,
    providerCostUsd: billing.providerCostUsd,
    usageReported: true,
  };
}

export async function saveAnalysisDecision({
  db,
  symbol,
  snapshot,
  judgments,
  userId,
  analysisDate,
}: {
  db: Awaited<ReturnType<typeof import("../lib/db").getDb>>;
  symbol: string;
  snapshot: AnalysisRunSnapshot;
  judgments: BusinessJudgments;
  userId: string;
  analysisDate: string;
}): Promise<string> {
  const decision = buildAnalysisDecision(snapshot.stockData);
  const thesis =
    decision.signal === "WAIT"
      ? null
      : buildStockThesis({ ...decision, signal: decision.signal }, snapshot.simpleAnalysis);
  const id = randomUUID();
  const now = new Date();
  await db.insert(stockAnalysis).values({
    id,
    symbol,
    analysisDate,
    signal: decision.signal,
    confidence: null,
    reasoning: JSON.stringify({ ...decision, judgments }),
    simpleAnalysisJson: snapshot.simpleAnalysis ? JSON.stringify(snapshot.simpleAnalysis) : null,
    thesisJson: thesis ? JSON.stringify(thesis) : null,
    thesisVersion: STOCK_THESIS_VERSION,
    priceAtAnalysis: snapshot.stockData.currentPrice,
    lastTriggeredByUserId: userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.update(stock).set({ lastAnalyzedAt: now }).where(eq(stock.symbol, symbol));
  return id;
}
