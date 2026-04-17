import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { stockAnalysis, dailySignal, stock, stockMemory } from "../lib/schema";
import { authMiddleware } from "./middleware";
import { buildInitialMemory } from "./memory";
import { refreshStockMetrics } from "../lib/metrics";
import { parseAiJson, splitMemoryUpdate } from "../lib/ai-parse";

export type Signal = "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type RecommendationResult = {
  id: string;
  signal: Signal;
  confidence: number;
  weeklyOutlook: string;
  keyBullishFactors: string[];
  keyBearishFactors: string[];
  riskLevel: RiskLevel;
  priceTarget: number | null;
  stopLoss: number | null;
  reasoning: string;
  signalChanged?: boolean;
  priceAtAnalysis: number | null;
  weekStart: string;
  weekEnd: string;
};

// ─── Yahoo Finance data gathering ─────────────────────────────────────────────

async function gatherStockData(symbol: string) {
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yf = new YahooFinance({
    suppressNotices: ["ripHistorical", "yahooSurvey"],
  });
  const quote = (await yf.quote(symbol)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  const period1 = new Date();
  period1.setDate(period1.getDate() - 90);

  const [historical, summary] = await Promise.all([
    (
      yf.historical(symbol, {
        period1,
        period2: new Date(),
        interval: "1d",
      }) as Promise<any[]>
    ).catch(() => []), // eslint-disable-line @typescript-eslint/no-explicit-any
    (
      yf.quoteSummary(symbol, {
        modules: [
          "financialData",
          "defaultKeyStatistics",
          "calendarEvents",
          "assetProfile",
        ],
      }) as Promise<any>
    ).catch(() => null), // eslint-disable-line @typescript-eslint/no-explicit-any
  ]);

  const closes = (historical as any[])
    .map((h: any) => h.close)
    .filter(Boolean) as number[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const volumes = (historical as any[])
    .map((h: any) => h.volume)
    .filter(Boolean) as number[]; // eslint-disable-line @typescript-eslint/no-explicit-any

  const sma20 =
    closes.length >= 20
      ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20
      : null;
  const sma50 =
    closes.length >= 50
      ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50
      : null;
  const recentVol =
    volumes.length >= 5 ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : 0;
  const olderVol =
    volumes.length >= 20
      ? volumes.slice(-20, -5).reduce((a, b) => a + b, 0) / 15
      : recentVol;
  const volumeTrend =
    olderVol > 0 ? ((recentVol - olderVol) / olderVol) * 100 : 0;
  const priceNow: number = quote.regularMarketPrice ?? 0;
  const price5d = closes[closes.length - 6] ?? priceNow;
  const price20d = closes[closes.length - 21] ?? priceNow;

  return {
    symbol,
    currentPrice: priceNow,
    dayChange: (quote.regularMarketChangePercent ?? 0) as number,
    marketCap: quote.marketCap as number | undefined,
    peRatio: quote.trailingPE as number | undefined,
    forwardPE: quote.forwardPE as number | undefined,
    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh as number | undefined,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow as number | undefined,
    beta: quote.beta as number | undefined,
    sma20,
    sma50,
    volumeTrend,
    momentum5d: price5d > 0 ? ((priceNow - price5d) / price5d) * 100 : 0,
    momentum20d: price20d > 0 ? ((priceNow - price20d) / price20d) * 100 : 0,
    priceVsSMA20: sma20 ? ((priceNow - sma20) / sma20) * 100 : null,
    priceVsSMA50: sma50 ? ((priceNow - sma50) / sma50) * 100 : null,
    earningsDate: summary?.calendarEvents?.earnings?.earningsDate?.[0] ?? null,
    revenueGrowth: summary?.financialData?.revenueGrowth ?? null,
    profitMargin: summary?.financialData?.profitMargins ?? null,
    returnOnEquity: summary?.financialData?.returnOnEquity ?? null,
    debtToEquity: summary?.financialData?.debtToEquity ?? null,
    freeCashflow: summary?.financialData?.freeCashflow ?? null,
    sector: summary?.assetProfile?.sector ?? null,
    industry: summary?.assetProfile?.industry ?? null,
  };
}

type StockData = Awaited<ReturnType<typeof gatherStockData>>;

// ─── AI prompt (includes memory + metrics context) ───────────────────────────

function buildPrompt(
  d: StockData,
  memory: string,
  metrics: string,
  isDaily: boolean,
  weekStart: string,
  weekEnd: string,
) {
  const fmt = (n: number | null | undefined, dec = 2) =>
    n != null ? n.toFixed(dec) : "N/A";
  return `You are an expert stock analyst with persistent memory. Provide a structured recommendation.

## STOCK MEMORY (accumulated context — your prior research)
${memory}

## SIMPLE MAN METRICS (objective performance — no opinion needed)
${metrics}

## CURRENT MARKET DATA
STOCK: ${d.symbol} | SECTOR: ${d.sector ?? "Unknown"} | INDUSTRY: ${d.industry ?? "Unknown"}
PRICE: $${fmt(d.currentPrice)} (${fmt(d.dayChange)}% today) | 52W: $${fmt(d.fiftyTwoWeekLow)}–$${fmt(d.fiftyTwoWeekHigh)}
MARKET CAP: ${d.marketCap ? "$" + (d.marketCap / 1e9).toFixed(1) + "B" : "N/A"} | BETA: ${fmt(d.beta)}
SMA20: ${fmt(d.priceVsSMA20)}% | SMA50: ${fmt(d.priceVsSMA50)}%
MOMENTUM: 5d ${fmt(d.momentum5d)}% | 20d ${fmt(d.momentum20d)}% | Vol trend ${fmt(d.volumeTrend, 1)}%
P/E: ${fmt(d.peRatio, 1)} | Fwd P/E: ${fmt(d.forwardPE, 1)} | D/E: ${fmt(d.debtToEquity, 1)}
Profit margin: ${d.profitMargin != null ? (d.profitMargin * 100).toFixed(1) + "%" : "N/A"} | ROE: ${d.returnOnEquity != null ? (d.returnOnEquity * 100).toFixed(1) + "%" : "N/A"}
Next earnings: ${d.earningsDate ? new Date(d.earningsDate).toDateString() : "N/A"}

IMPORTANT: If Simple Man Metrics show strong momentum but fundamentals are weak (high debt, poor margins), flag this conflict in your reasoning.

${isDaily ? `CONTEXT: Daily update for week ${weekStart}–${weekEnd}. Only set signalChanged=true if something material has shifted.` : `CONTEXT: Weekly rec for ${weekStart}–${weekEnd}.`}

Respond with two blocks and NOTHING ELSE. No markdown fences, no commentary.

1. JSON:
{"signal":"STRONG_BUY"|"BUY"|"HOLD"|"SELL"|"STRONG_SELL","confidence":<0-100>,"weeklyOutlook":"<2-3 sentences>","keyBullishFactors":["<f>","<f>","<f>"],"keyBearishFactors":["<f>","<f>","<f>"],"riskLevel":"LOW"|"MEDIUM"|"HIGH","priceTarget":<number|null>,"stopLoss":<number|null>,"reasoning":"<3-4 sentences, note any conflict between momentum and fundamentals>","signalChanged":<boolean>}

2. MEMORY_UPDATE:
<updated full memory markdown>`;
}

function buildJsonOnlyRetryPrompt(
  d: StockData,
  metrics: string,
  isDaily: boolean,
  weekStart: string,
  weekEnd: string,
) {
  const fmt = (n: number | null | undefined, dec = 2) =>
    n != null ? n.toFixed(dec) : "N/A";
  return `You are an expert stock analyst. Return ONLY one valid JSON object. No markdown fences. No prose before or after. No MEMORY_UPDATE block.

STOCK: ${d.symbol} | SECTOR: ${d.sector ?? "Unknown"} | INDUSTRY: ${d.industry ?? "Unknown"}
PRICE: $${fmt(d.currentPrice)} (${fmt(d.dayChange)}% today)
SMA20: ${fmt(d.priceVsSMA20)}% | SMA50: ${fmt(d.priceVsSMA50)}%
MOMENTUM: 5d ${fmt(d.momentum5d)}% | 20d ${fmt(d.momentum20d)}% | Vol trend ${fmt(d.volumeTrend, 1)}%
P/E: ${fmt(d.peRatio, 1)} | Fwd P/E: ${fmt(d.forwardPE, 1)} | D/E: ${fmt(d.debtToEquity, 1)}
Profit margin: ${d.profitMargin != null ? (d.profitMargin * 100).toFixed(1) + "%" : "N/A"} | ROE: ${d.returnOnEquity != null ? (d.returnOnEquity * 100).toFixed(1) + "%" : "N/A"}
Next earnings: ${d.earningsDate ? new Date(d.earningsDate).toDateString() : "N/A"}
METRICS: ${metrics}
CONTEXT: ${isDaily ? `Daily update for week ${weekStart}–${weekEnd}. Only set signalChanged=true if something material changed.` : `Weekly recommendation for ${weekStart}–${weekEnd}.`}

Required JSON shape:
{"signal":"STRONG_BUY"|"BUY"|"HOLD"|"SELL"|"STRONG_SELL","confidence":<0-100>,"weeklyOutlook":"<2-3 sentences>","keyBullishFactors":["<f>","<f>","<f>"],"keyBearishFactors":["<f>","<f>","<f>"],"riskLevel":"LOW"|"MEDIUM"|"HIGH","priceTarget":<number|null>,"stopLoss":<number|null>,"reasoning":"<3-4 sentences>","signalChanged":<boolean>}`;
}

// ─── AI call ──────────────────────────────────────────────────────────────────

async function callAI(
  prompt: string,
): Promise<{ json: string; memoryUpdate: string | null }> {
  const { chat } = await import("@tanstack/ai");
  const { createOpenaiChat } = await import("@tanstack/ai-openai");
  const adapter = createOpenaiChat(
    "z-ai/glm-5.1" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    process.env.OPENROUTER_API_KEY ?? "",
    { baseURL: "https://openrouter.ai/api/v1" },
  );
  const text = await chat({
    adapter,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    maxTokens: 3200,
  });
  const { jsonPart, memoryUpdate } = splitMemoryUpdate(text);
  return { json: jsonPart, memoryUpdate };
}

async function callAIJsonOnly(prompt: string): Promise<string> {
  const { chat } = await import("@tanstack/ai");
  const { createOpenaiChat } = await import("@tanstack/ai-openai");
  const adapter = createOpenaiChat(
    "z-ai/glm-5.1" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    process.env.OPENROUTER_API_KEY ?? "",
    { baseURL: "https://openrouter.ai/api/v1" },
  );

  return chat({
    adapter,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    maxTokens: 1200,
  });
}

// ─── Memory helpers ───────────────────────────────────────────────────────────

async function readMemory(symbol: string): Promise<string> {
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  const [row] = await db
    .select()
    .from(stockMemory)
    .where(eq(stockMemory.symbol, symbol));
  return row?.content ?? buildInitialMemory(symbol);
}

async function writeMemory(symbol: string, content: string) {
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  await db
    .insert(stockMemory)
    .values({ symbol, content, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: stockMemory.symbol,
      set: { content, updatedAt: new Date() },
    });
}

// ─── Compute next_check_at based on upcoming events ──────────────────────────

function computeNextCheck(earningsDate: Date | null | undefined): Date {
  const now = new Date();
  if (earningsDate) {
    const daysUntil =
      (earningsDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysUntil > 0 && daysUntil <= 7) {
      // Check the day before earnings
      const dayBefore = new Date(earningsDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      dayBefore.setHours(9, 0, 0, 0);
      return dayBefore;
    }
  }
  // Default: next Monday
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  nextMonday.setHours(22, 0, 0, 0);
  return nextMonday;
}

// ─── Server functions (no user_id — global analysis) ─────────────────────────

export const generateWeeklyAnalysis = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { symbol: string }) => data)
  .handler(async ({ data, context }): Promise<RecommendationResult> => {
    const ctx = (context ?? {}) as {
      session: { sub: string } | null;
      analysisCredits: number;
      isAdmin: boolean;
    };
    if (!ctx.session) throw new Error("Unauthorized");
    if (!ctx.isAdmin && (ctx.analysisCredits ?? 0) < 1)
      throw new Error("CREDITS_REQUIRED");

    const { getDb } = await import("../lib/db");
    const { user } = await import("../lib/schema");
    const db = await getDb();

    const today = new Date();
    const weekStart = format(
      startOfWeek(today, { weekStartsOn: 1 }),
      "yyyy-MM-dd",
    );
    const weekEnd = format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");

    const [stockData, memory, metrics] = await Promise.all([
      gatherStockData(data.symbol),
      readMemory(data.symbol),
      refreshStockMetrics(data.symbol),
    ]);

    const metricsStr = `WTD: ${metrics.perfWtd?.toFixed(1) ?? "N/A"}% | Last week: ${metrics.perfLastWeek?.toFixed(1) ?? "N/A"}%
MTD: ${metrics.perfMtd?.toFixed(1) ?? "N/A"}% | Last month: ${metrics.perfLastMonth?.toFixed(1) ?? "N/A"}%
YTD: ${metrics.perfYtd?.toFixed(1) ?? "N/A"}% | Last year: ${metrics.perfLastYear?.toFixed(1) ?? "N/A"}%
Momentum: ${metrics.momentumSignal?.toUpperCase() ?? "UNKNOWN"}`;

    const { json, memoryUpdate } = await callAI(
      buildPrompt(stockData, memory, metricsStr, false, weekStart, weekEnd),
    );

    let parsed: Omit<
      RecommendationResult,
      "id" | "priceAtAnalysis" | "weekStart" | "weekEnd"
    >;
    try {
      parsed = parseAiJson(json);
    } catch {
      const retryJson = await callAIJsonOnly(
        buildJsonOnlyRetryPrompt(
          stockData,
          metricsStr,
          false,
          weekStart,
          weekEnd,
        ),
      );
      try {
        parsed = parseAiJson(retryJson);
      } catch {
        throw new Error(`Bad AI response: ${json.slice(0, 200)}`);
      }
    }

    // Upsert global analysis (unique per symbol+week)
    const existing = await db
      .select()
      .from(stockAnalysis)
      .where(eq(stockAnalysis.symbol, data.symbol));
    const thisWeek = existing.find((r) => r.weekStart === weekStart);
    const recId = thisWeek?.id ?? randomUUID();
    const now = new Date();

    if (thisWeek) {
      await db
        .update(stockAnalysis)
        .set({
          signal: parsed.signal,
          confidence: parsed.confidence,
          reasoning: JSON.stringify(parsed),
          priceAtAnalysis: stockData.currentPrice,
          lastTriggeredByUserId: ctx.session.sub,
          updatedAt: now,
        })
        .where(eq(stockAnalysis.id, recId));
    } else {
      await db.insert(stockAnalysis).values({
        id: recId,
        symbol: data.symbol,
        weekStart,
        weekEnd,
        signal: parsed.signal,
        confidence: parsed.confidence,
        reasoning: JSON.stringify(parsed),
        priceAtAnalysis: stockData.currentPrice,
        lastTriggeredByUserId: ctx.session.sub,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Update stock catalog with next check time
    const earningsDate = stockData.earningsDate
      ? new Date(stockData.earningsDate)
      : null;
    await db
      .update(stock)
      .set({ lastAnalyzedAt: now, nextCheckAt: computeNextCheck(earningsDate) })
      .where(eq(stock.symbol, data.symbol));

    if (memoryUpdate) await writeMemory(data.symbol, memoryUpdate);

    if (!ctx.isAdmin) {
      const [u] = await db
        .select({ analysisCredits: user.analysisCredits })
        .from(user)
        .where(eq(user.id, ctx.session.sub));
      await db
        .update(user)
        .set({ analysisCredits: Math.max(0, (u?.analysisCredits ?? 0) - 1) })
        .where(eq(user.id, ctx.session.sub));
    }

    return {
      id: recId,
      ...parsed,
      priceAtAnalysis: stockData.currentPrice,
      weekStart,
      weekEnd,
    };
  });

export const generateDailyUpdate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { symbol: string; analysisId: string }) => data)
  .handler(async ({ data, context }): Promise<RecommendationResult> => {
    const ctx = (context ?? {}) as {
      session: { sub: string } | null;
      analysisCredits: number;
      isAdmin: boolean;
    };
    if (!ctx.session) throw new Error("Unauthorized");
    if (!ctx.isAdmin && (ctx.analysisCredits ?? 0) < 1)
      throw new Error("CREDITS_REQUIRED");

    const { getDb } = await import("../lib/db");
    const { user } = await import("../lib/schema");
    const db = await getDb();

    const today = new Date();
    const weekStart = format(
      startOfWeek(today, { weekStartsOn: 1 }),
      "yyyy-MM-dd",
    );
    const weekEnd = format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");

    const [analysis] = await db
      .select()
      .from(stockAnalysis)
      .where(eq(stockAnalysis.id, data.analysisId));
    if (!analysis) throw new Error("Analysis not found");

    const [stockData, memory, metrics] = await Promise.all([
      gatherStockData(data.symbol),
      readMemory(data.symbol),
      refreshStockMetrics(data.symbol),
    ]);

    const metricsStr = `WTD: ${metrics.perfWtd?.toFixed(1) ?? "N/A"}% | MTD: ${metrics.perfMtd?.toFixed(1) ?? "N/A"}% | YTD: ${metrics.perfYtd?.toFixed(1) ?? "N/A"}%
Momentum: ${metrics.momentumSignal?.toUpperCase() ?? "UNKNOWN"}`;

    const { json, memoryUpdate } = await callAI(
      buildPrompt(stockData, memory, metricsStr, true, weekStart, weekEnd),
    );

    let parsed: Omit<
      RecommendationResult,
      "id" | "priceAtAnalysis" | "weekStart" | "weekEnd"
    >;
    try {
      parsed = parseAiJson(json);
    } catch {
      const retryJson = await callAIJsonOnly(
        buildJsonOnlyRetryPrompt(
          stockData,
          metricsStr,
          true,
          weekStart,
          weekEnd,
        ),
      );
      try {
        parsed = parseAiJson(retryJson);
      } catch {
        throw new Error(`Bad AI response: ${json.slice(0, 200)}`);
      }
    }

    const changed = parsed.signal !== analysis.signal;
    await db
      .update(stockAnalysis)
      .set({
        signal: parsed.signal,
        confidence: parsed.confidence,
        reasoning: JSON.stringify(parsed),
        priceAtAnalysis: stockData.currentPrice,
        lastTriggeredByUserId: ctx.session.sub,
        updatedAt: new Date(),
      })
      .where(eq(stockAnalysis.id, data.analysisId));

    await db.insert(dailySignal).values({
      id: randomUUID(),
      stockAnalysisId: data.analysisId,
      symbol: data.symbol,
      date: format(today, "yyyy-MM-dd"),
      signal: parsed.signal,
      note: parsed.reasoning,
      priceAtUpdate: stockData.currentPrice,
      signalChanged: changed,
      trigger: "manual",
      createdAt: new Date(),
    });

    if (memoryUpdate) await writeMemory(data.symbol, memoryUpdate);

    if (!ctx.isAdmin) {
      const [u] = await db
        .select({ analysisCredits: user.analysisCredits })
        .from(user)
        .where(eq(user.id, ctx.session.sub));
      await db
        .update(user)
        .set({ analysisCredits: Math.max(0, (u?.analysisCredits ?? 0) - 1) })
        .where(eq(user.id, ctx.session.sub));
    }

    return {
      id: data.analysisId,
      ...parsed,
      signalChanged: changed,
      priceAtAnalysis: stockData.currentPrice,
      weekStart,
      weekEnd,
    };
  });
