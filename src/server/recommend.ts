import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { stockAnalysis, dailySignal, stock, stockMemory, supervisorAlert } from "../lib/schema";
import { authMiddleware } from "./middleware";
import { buildInitialMemory } from "./memory";
import { refreshStockMetrics } from "../lib/metrics";
import { parseAiJson, parseSupervisorResponse } from "../lib/ai-parse";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Signal = "BUY" | "SELL";
export type Cycle = "ACCUMULATION" | "MARKUP" | "DISTRIBUTION" | "MARKDOWN";
export type CycleTimeframe = "SHORT" | "MEDIUM" | "LONG";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

// Taleb alert types
export type TalebAlertType =
  | "BLACK_SWAN_BUY" // Extreme asymmetric upside — deep value + low downside
  | "BLACK_SWAN_SELL" // Extreme fragility — hidden risk bomb
  | "FRAGILE" // High debt, single revenue stream, low cash buffer
  | "ANTIFRAGILE" // Gets stronger from volatility, cash-rich, diversified
  | "NONE"; // Nothing extreme detected

// Buffett alert types
export type BuffettAlertType =
  | "MARGIN_OF_SAFETY" // Price well below intrinsic value — buy with confidence
  | "OVERPRICED" // Fundamentals don't justify valuation
  | "STRONG_MOAT" // Clear durable competitive advantage
  | "NO_MOAT" // Commoditized, easily disrupted
  | "RATIONAL_HOLD" // Numbers support continued ownership at current price
  | "RATIONAL_AVOID"; // Numbers don't support entering at current price

export type SupervisorSeverity = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";

export type SupervisorReview = {
  alertType: TalebAlertType | BuffettAlertType;
  severity: SupervisorSeverity;
  title: string;
  content: string;
};

export type RecommendationResult = {
  id: string;
  signal: Signal;
  cycle: Cycle | null;
  cycleTimeframe: CycleTimeframe | null;
  cycleStrength: number | null;
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
  talebreview: SupervisorReview | null;
  buffettReview: SupervisorReview | null;
};

// ─── Yahoo Finance data gathering ─────────────────────────────────────────────

async function gatherStockData(symbol: string) {
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yf = new YahooFinance({
    suppressNotices: ["ripHistorical", "yahooSurvey"],
  });
  const quote = (await yf.quote(symbol)) as any;

  const period1 = new Date();
  period1.setDate(period1.getDate() - 90);

  const [historical, summary] = await Promise.all([
    (
      yf.historical(symbol, {
        period1,
        period2: new Date(),
        interval: "1d",
      }) as Promise<any[]>
    ).catch(() => []),
    (
      yf.quoteSummary(symbol, {
        modules: ["financialData", "defaultKeyStatistics", "calendarEvents", "assetProfile"],
      }) as Promise<any>
    ).catch(() => null),
  ]);

  const closes = (historical as any[]).map((h: any) => h.close).filter(Boolean) as number[];
  const volumes = (historical as any[]).map((h: any) => h.volume).filter(Boolean) as number[];

  const sma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
  const recentVol = volumes.length >= 5 ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : 0;
  const olderVol =
    volumes.length >= 20 ? volumes.slice(-20, -5).reduce((a, b) => a + b, 0) / 15 : recentVol;
  const volumeTrend = olderVol > 0 ? ((recentVol - olderVol) / olderVol) * 100 : 0;
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

// ─── AI prompt ────────────────────────────────────────────────────────────────

function buildPrompt(
  d: StockData,
  memory: string,
  metrics: string,
  isDaily: boolean,
  weekStart: string,
  weekEnd: string,
) {
  const fmt = (n: number | null | undefined, dec = 2) => (n != null ? n.toFixed(dec) : "N/A");

  return `You are a senior equity analyst with a board of two legendary supervisors.
Your job: produce a structured multi-section response. Follow the format exactly — no markdown fences, no extra commentary.

## STOCK MEMORY (accumulated context)
${memory}

## OBJECTIVE METRICS (no opinion — pure math)
${metrics}

## CURRENT MARKET DATA
STOCK: ${d.symbol} | SECTOR: ${d.sector ?? "Unknown"} | INDUSTRY: ${d.industry ?? "Unknown"}
PRICE: $${fmt(d.currentPrice)} (${fmt(d.dayChange)}% today) | 52W: $${fmt(d.fiftyTwoWeekLow)}–$${fmt(d.fiftyTwoWeekHigh)}
MARKET CAP: ${d.marketCap ? "$" + (d.marketCap / 1e9).toFixed(1) + "B" : "N/A"} | BETA: ${fmt(d.beta)}
SMA20: ${fmt(d.priceVsSMA20)}% vs price | SMA50: ${fmt(d.priceVsSMA50)}% vs price
MOMENTUM: 5d ${fmt(d.momentum5d)}% | 20d ${fmt(d.momentum20d)}% | Vol trend ${fmt(d.volumeTrend, 1)}%
P/E: ${fmt(d.peRatio, 1)} | Fwd P/E: ${fmt(d.forwardPE, 1)} | D/E: ${fmt(d.debtToEquity, 1)}
Profit margin: ${d.profitMargin != null ? (d.profitMargin * 100).toFixed(1) + "%" : "N/A"} | ROE: ${d.returnOnEquity != null ? (d.returnOnEquity * 100).toFixed(1) + "%" : "N/A"}
Revenue growth: ${d.revenueGrowth != null ? (d.revenueGrowth * 100).toFixed(1) + "%" : "N/A"} | FCF: ${d.freeCashflow ? "$" + (d.freeCashflow / 1e9).toFixed(2) + "B" : "N/A"}
Next earnings: ${d.earningsDate ? new Date(d.earningsDate).toDateString() : "N/A"}

${
  isDaily
    ? `CONTEXT: Daily update for week ${weekStart}–${weekEnd}. Only set signalChanged=true if something material shifted.`
    : `CONTEXT: Weekly recommendation for ${weekStart}–${weekEnd}.`
}

────────────────────────────────────────────────────────────────
CYCLE DEFINITIONS (use these to pick the cycle):
- ACCUMULATION: Smart money quietly building. Sideways/low vol near lows. Signal → BUY (patient)
- MARKUP: Uptrend confirmed, momentum building, breakouts. Signal → BUY (conviction)
- DISTRIBUTION: Smart money quietly exiting. Sideways near highs, vol divergence. Signal → SELL (early alert)
- MARKDOWN: Downtrend confirmed, sellers in control. Signal → SELL (exit/avoid)

TIMEFRAME DEFINITIONS:
- SHORT: days–2 weeks (price action, volume, RSI)
- MEDIUM: weeks–quarter (SMAs, earnings, sector rotation)
- LONG: quarters–year (fundamentals, macro, valuation)
────────────────────────────────────────────────────────────────

Respond with EXACTLY these four sections, nothing else:

1. SIGNAL_JSON:
{"signal":"BUY"|"SELL","cycle":"ACCUMULATION"|"MARKUP"|"DISTRIBUTION"|"MARKDOWN","cycleTimeframe":"SHORT"|"MEDIUM"|"LONG","cycleStrength":<0-100>,"confidence":<0-100>,"weeklyOutlook":"<2-3 sentences>","keyBullishFactors":["<f>","<f>","<f>"],"keyBearishFactors":["<f>","<f>","<f>"],"riskLevel":"LOW"|"MEDIUM"|"HIGH","priceTarget":<number|null>,"stopLoss":<number|null>,"reasoning":"<3-4 sentences>","signalChanged":<boolean>}

2. TALEB_JSON:
Nassim Taleb's lens: tail risk, fragility, convexity, black swans. Only fire BLACK_SWAN_BUY or BLACK_SWAN_SELL if something is truly extreme. Use NONE for severity LOW when nothing is extreme.
{"alertType":"BLACK_SWAN_BUY"|"BLACK_SWAN_SELL"|"FRAGILE"|"ANTIFRAGILE"|"NONE","severity":"LOW"|"MEDIUM"|"HIGH"|"EXTREME","title":"<10 words max>","content":"<2-3 sentences in Taleb's direct, probabilistic voice>"}

3. BUFFETT_JSON:
Warren Buffett's lens: moat, margin of safety, rationality, long-term value. Always opine. If momentum is strong but fundamentals are weak, say so directly in his grandfather voice.
{"alertType":"MARGIN_OF_SAFETY"|"OVERPRICED"|"STRONG_MOAT"|"NO_MOAT"|"RATIONAL_HOLD"|"RATIONAL_AVOID","severity":"LOW"|"MEDIUM"|"HIGH","title":"<10 words max>","content":"<2-3 sentences in Buffett's plain, patient voice>"}

4. MEMORY_UPDATE:
<updated full memory markdown — include today's signal, cycle, and any new observations>`;
}

function buildJsonOnlyRetryPrompt(
  d: StockData,
  metrics: string,
  isDaily: boolean,
  weekStart: string,
  weekEnd: string,
) {
  const fmt = (n: number | null | undefined, dec = 2) => (n != null ? n.toFixed(dec) : "N/A");
  return `You are an expert stock analyst. Return ONLY one valid JSON object. No markdown fences. No prose.

STOCK: ${d.symbol} | PRICE: $${fmt(d.currentPrice)} (${fmt(d.dayChange)}% today)
SMA20: ${fmt(d.priceVsSMA20)}% | SMA50: ${fmt(d.priceVsSMA50)}%
MOMENTUM: 5d ${fmt(d.momentum5d)}% | 20d ${fmt(d.momentum20d)}% | Vol trend ${fmt(d.volumeTrend, 1)}%
P/E: ${fmt(d.peRatio, 1)} | D/E: ${fmt(d.debtToEquity, 1)} | ROE: ${d.returnOnEquity != null ? (d.returnOnEquity * 100).toFixed(1) + "%" : "N/A"}
METRICS: ${metrics}
CONTEXT: ${isDaily ? `Daily update ${weekStart}–${weekEnd}.` : `Weekly rec ${weekStart}–${weekEnd}.`}

Required JSON (signal is BUY or SELL only, no HOLD/STRONG variants):
{"signal":"BUY"|"SELL","cycle":"ACCUMULATION"|"MARKUP"|"DISTRIBUTION"|"MARKDOWN","cycleTimeframe":"SHORT"|"MEDIUM"|"LONG","cycleStrength":<0-100>,"confidence":<0-100>,"weeklyOutlook":"<2-3 sentences>","keyBullishFactors":["<f>","<f>","<f>"],"keyBearishFactors":["<f>","<f>","<f>"],"riskLevel":"LOW"|"MEDIUM"|"HIGH","priceTarget":<number|null>,"stopLoss":<number|null>,"reasoning":"<3-4 sentences>","signalChanged":<boolean>}`;
}

// ─── AI call ──────────────────────────────────────────────────────────────────

const AI_MODEL = process.env.AI_MODEL ?? "google/gemini-2.0-flash-001";
const AI_TIMEOUT_MS = 90_000; // 90s — well under Cloudflare's 100s gateway timeout

async function callAI(prompt: string): Promise<string> {
  const { chat } = await import("@tanstack/ai");
  const { createOpenaiChat } = await import("@tanstack/ai-openai");
  const adapter = createOpenaiChat(AI_MODEL as any, process.env.OPENROUTER_API_KEY ?? "", {
    baseURL: "https://openrouter.ai/api/v1",
  });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("AI call timed out after 90s")), AI_TIMEOUT_MS),
  );

  return Promise.race([
    chat({
      adapter,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      maxTokens: 4000,
    }),
    timeout,
  ]);
}

// ─── Memory helpers ───────────────────────────────────────────────────────────

async function readMemory(symbol: string): Promise<string> {
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  const [row] = await db.select().from(stockMemory).where(eq(stockMemory.symbol, symbol));
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

// ─── Save supervisor alerts ───────────────────────────────────────────────────

async function saveSupervisorAlerts(
  db: Awaited<ReturnType<typeof import("../lib/db").getDb>>,
  symbol: string,
  analysisId: string,
  talebreview: SupervisorReview | null,
  buffettReview: SupervisorReview | null,
) {
  const alerts = [
    talebreview ? { supervisor: "TALEB", ...talebreview } : null,
    buffettReview ? { supervisor: "BUFFETT", ...buffettReview } : null,
  ].filter(Boolean) as Array<{
    supervisor: string;
    alertType: string;
    severity: string;
    title: string;
    content: string;
  }>;

  for (const alert of alerts) {
    await db.insert(supervisorAlert).values({
      id: randomUUID(),
      symbol,
      stockAnalysisId: analysisId,
      supervisor: alert.supervisor,
      alertType: alert.alertType,
      severity: alert.severity,
      title: alert.title,
      content: alert.content,
      createdAt: new Date(),
    });
  }
}

// ─── Next check scheduling ────────────────────────────────────────────────────

function computeNextCheck(earningsDate: Date | null | undefined): Date {
  const now = new Date();
  if (earningsDate) {
    const daysUntil = (earningsDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysUntil > 0 && daysUntil <= 7) {
      const dayBefore = new Date(earningsDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      dayBefore.setHours(9, 0, 0, 0);
      return dayBefore;
    }
  }
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  nextMonday.setHours(22, 0, 0, 0);
  return nextMonday;
}

// ─── Parse full AI response ───────────────────────────────────────────────────

function parseFullResponse(raw: string): {
  signal: Omit<
    RecommendationResult,
    "id" | "priceAtAnalysis" | "weekStart" | "weekEnd" | "talebreview" | "buffettReview"
  >;
  talebreview: SupervisorReview | null;
  buffettReview: SupervisorReview | null;
  memoryUpdate: string | null;
} {
  const { signalJson, talebJson, buffettJson, memoryUpdate } = parseSupervisorResponse(raw);

  if (!signalJson) throw new Error(`No SIGNAL_JSON found in response: ${raw.slice(0, 300)}`);

  const signal = parseAiJson<any>(signalJson);

  let talebreview: SupervisorReview | null = null;
  if (talebJson) {
    try {
      talebreview = parseAiJson<SupervisorReview>(talebJson);
    } catch {
      // Non-fatal — Taleb optional
    }
  }

  let buffettReview: SupervisorReview | null = null;
  if (buffettJson) {
    try {
      buffettReview = parseAiJson<SupervisorReview>(buffettJson);
    } catch {
      // Non-fatal — Buffett optional
    }
  }

  return { signal, talebreview, buffettReview, memoryUpdate };
}

// ─── Server functions ─────────────────────────────────────────────────────────

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
    if (!ctx.isAdmin && (ctx.analysisCredits ?? 0) < 1) throw new Error("CREDITS_REQUIRED");

    const { getDb } = await import("../lib/db");
    const { user } = await import("../lib/schema");
    const db = await getDb();

    const today = new Date();
    const weekStart = format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const weekEnd = format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");

    const [stockData, memory, metrics] = await Promise.all([
      gatherStockData(data.symbol),
      readMemory(data.symbol),
      refreshStockMetrics(data.symbol),
    ]);

    const metricsStr = [
      `Performance: WTD ${metrics.perfWtd?.toFixed(1) ?? "N/A"}% | Last week ${metrics.perfLastWeek?.toFixed(1) ?? "N/A"}% | MTD ${metrics.perfMtd?.toFixed(1) ?? "N/A"}% | YTD ${metrics.perfYtd?.toFixed(1) ?? "N/A"}%`,
      `Momentum: ${metrics.momentumSignal?.toUpperCase() ?? "UNKNOWN"} | RSI14: ${metrics.rsi14?.toFixed(1) ?? "N/A"} | MACD histogram: ${metrics.macdHistogram?.toFixed(3) ?? "N/A"}`,
      `SMA200: ${metrics.sma200 != null && metrics.currentPrice ? (((metrics.currentPrice - metrics.sma200) / metrics.sma200) * 100).toFixed(1) + "% vs price" : "N/A"} | ATR14: ${metrics.atr14?.toFixed(2) ?? "N/A"}`,
      `Relative volume: ${metrics.relativeVolume?.toFixed(2) ?? "N/A"}x | 52w: ${metrics.pct52wHigh?.toFixed(1) ?? "N/A"}% from high, ${metrics.pct52wLow?.toFixed(1) ?? "N/A"}% from low`,
      `ROE: ${metrics.returnOnEquity != null ? (metrics.returnOnEquity * 100).toFixed(1) + "%" : "N/A"} | Rev growth YoY: ${metrics.revenueGrowthYoy != null ? (metrics.revenueGrowthYoy * 100).toFixed(1) + "%" : "N/A"} | FCF yield: ${metrics.freeCashflowYield?.toFixed(2) ?? "N/A"}%`,
    ].join("\n");

    const raw = await callAI(buildPrompt(stockData, memory, metricsStr, false, weekStart, weekEnd));

    let parsed: ReturnType<typeof parseFullResponse>;
    try {
      parsed = parseFullResponse(raw);
    } catch {
      // Fallback: retry for signal JSON only
      const retryRaw = await callAI(
        buildJsonOnlyRetryPrompt(stockData, metricsStr, false, weekStart, weekEnd),
      );
      const signalOnly = parseAiJson<any>(retryRaw);
      parsed = { signal: signalOnly, talebreview: null, buffettReview: null, memoryUpdate: null };
    }

    const { signal: parsedSignal, talebreview, buffettReview, memoryUpdate } = parsed;

    // Upsert global analysis
    const existing = await db
      .select()
      .from(stockAnalysis)
      .where(eq(stockAnalysis.symbol, data.symbol));
    const thisWeek = existing.find((r) => r.weekStart === weekStart);
    const recId = thisWeek?.id ?? randomUUID();
    const now = new Date();

    const analysisPayload = {
      signal: parsedSignal.signal as Signal,
      cycle: parsedSignal.cycle ?? null,
      cycleTimeframe: parsedSignal.cycleTimeframe ?? null,
      cycleStrength: parsedSignal.cycleStrength ?? null,
      confidence: parsedSignal.confidence,
      reasoning: JSON.stringify(parsedSignal),
      priceAtAnalysis: stockData.currentPrice,
      lastTriggeredByUserId: ctx.session.sub,
      updatedAt: now,
    };

    if (thisWeek) {
      await db.update(stockAnalysis).set(analysisPayload).where(eq(stockAnalysis.id, recId));
    } else {
      await db.insert(stockAnalysis).values({
        id: recId,
        symbol: data.symbol,
        weekStart,
        weekEnd,
        ...analysisPayload,
        createdAt: now,
      });
    }

    // Save supervisor alerts
    await saveSupervisorAlerts(db, data.symbol, recId, talebreview, buffettReview);

    // Update stock next check
    const earningsDate = stockData.earningsDate ? new Date(stockData.earningsDate) : null;
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
      ...parsedSignal,
      signal: parsedSignal.signal as Signal,
      cycle: parsedSignal.cycle ?? null,
      cycleTimeframe: parsedSignal.cycleTimeframe ?? null,
      cycleStrength: parsedSignal.cycleStrength ?? null,
      priceAtAnalysis: stockData.currentPrice,
      weekStart,
      weekEnd,
      talebreview,
      buffettReview,
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
    if (!ctx.isAdmin && (ctx.analysisCredits ?? 0) < 1) throw new Error("CREDITS_REQUIRED");

    const { getDb } = await import("../lib/db");
    const { user } = await import("../lib/schema");
    const db = await getDb();

    const today = new Date();
    const weekStart = format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");
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

    const metricsStr = [
      `WTD ${metrics.perfWtd?.toFixed(1) ?? "N/A"}% | MTD ${metrics.perfMtd?.toFixed(1) ?? "N/A"}% | YTD ${metrics.perfYtd?.toFixed(1) ?? "N/A"}%`,
      `Momentum: ${metrics.momentumSignal?.toUpperCase() ?? "UNKNOWN"} | RSI14: ${metrics.rsi14?.toFixed(1) ?? "N/A"} | MACD histogram: ${metrics.macdHistogram?.toFixed(3) ?? "N/A"}`,
      `Rel vol: ${metrics.relativeVolume?.toFixed(2) ?? "N/A"}x | 52w: ${metrics.pct52wHigh?.toFixed(1) ?? "N/A"}% from high`,
    ].join("\n");

    const raw = await callAI(buildPrompt(stockData, memory, metricsStr, true, weekStart, weekEnd));

    let parsed: ReturnType<typeof parseFullResponse>;
    try {
      parsed = parseFullResponse(raw);
    } catch {
      const retryRaw = await callAI(
        buildJsonOnlyRetryPrompt(stockData, metricsStr, true, weekStart, weekEnd),
      );
      const signalOnly = parseAiJson<any>(retryRaw);
      parsed = { signal: signalOnly, talebreview: null, buffettReview: null, memoryUpdate: null };
    }

    const { signal: parsedSignal, talebreview, buffettReview, memoryUpdate } = parsed;
    const changed = parsedSignal.signal !== analysis.signal;

    await db
      .update(stockAnalysis)
      .set({
        signal: parsedSignal.signal as Signal,
        cycle: parsedSignal.cycle ?? null,
        cycleTimeframe: parsedSignal.cycleTimeframe ?? null,
        cycleStrength: parsedSignal.cycleStrength ?? null,
        confidence: parsedSignal.confidence,
        reasoning: JSON.stringify(parsedSignal),
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
      signal: parsedSignal.signal as Signal,
      cycle: parsedSignal.cycle ?? null,
      note: parsedSignal.reasoning,
      priceAtUpdate: stockData.currentPrice,
      signalChanged: changed,
      trigger: "manual",
      createdAt: new Date(),
    });

    await saveSupervisorAlerts(db, data.symbol, data.analysisId, talebreview, buffettReview);

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
      ...parsedSignal,
      signal: parsedSignal.signal as Signal,
      cycle: parsedSignal.cycle ?? null,
      cycleTimeframe: parsedSignal.cycleTimeframe ?? null,
      cycleStrength: parsedSignal.cycleStrength ?? null,
      signalChanged: changed,
      priceAtAnalysis: stockData.currentPrice,
      weekStart,
      weekEnd,
      talebreview,
      buffettReview,
    };
  });
