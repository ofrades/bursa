import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { format } from "date-fns";
import { stockAnalysis, dailySignal, stock, stockMemory } from "../lib/schema";
import { authMiddleware } from "./middleware";
import { buildInitialMemory } from "./memory";
import { ema } from "../lib/metrics";
import { parseAiJson, parseStructuredResponse } from "../lib/ai-parse";
import { calculateBilledCost } from "../lib/pricing";
import { AI_MODEL } from "../lib/ai-model";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Signal = "BUY" | "SELL";
export type Cycle = "ACCUMULATION" | "MARKUP" | "DISTRIBUTION" | "MARKDOWN";
export type CycleTimeframe = "SHORT" | "MEDIUM" | "LONG";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type RecommendationResult = {
  id: string;
  signal: Signal;
  weeklyCall?: "BUY" | "SELL" | "WAIT";
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
  weeklyTrend?: "uptrend" | "downtrend" | "sideways";
  pullbackTo21EMA?: boolean;
  consolidationBreakout21EMA?: boolean;
  priceAtAnalysis: number | null;
  analysisDate: string;
};

// ─── Yahoo Finance data gathering ─────────────────────────────────────────────

const SECTOR_BENCHMARKS: Record<string, string> = {
  technology: "XLK",
  "financial services": "XLF",
  healthcare: "XLV",
  "consumer cyclical": "XLY",
  "consumer defensive": "XLP",
  industrials: "XLI",
  energy: "XLE",
  utilities: "XLU",
  "real estate": "XLRE",
  "basic materials": "XLB",
  "communication services": "XLC",
};

function sectorBenchmarkSymbol(sector: string | null | undefined) {
  if (!sector) return null;
  return SECTOR_BENCHMARKS[sector.trim().toLowerCase()] ?? null;
}

function relativeReturn(
  stockCloses: number[],
  benchmarkCloses: number[],
  lookbackDays: number,
): number | null {
  if (stockCloses.length <= lookbackDays || benchmarkCloses.length <= lookbackDays) return null;
  const stockNow = stockCloses[stockCloses.length - 1];
  const stockThen = stockCloses[stockCloses.length - 1 - lookbackDays];
  const benchmarkNow = benchmarkCloses[benchmarkCloses.length - 1];
  const benchmarkThen = benchmarkCloses[benchmarkCloses.length - 1 - lookbackDays];
  if (!stockThen || !benchmarkThen) return null;

  const stockReturn = ((stockNow - stockThen) / stockThen) * 100;
  const benchmarkReturn = ((benchmarkNow - benchmarkThen) / benchmarkThen) * 100;
  return stockReturn - benchmarkReturn;
}

function revisionTrendFromEarnings(summary: any) {
  const trendRows = summary?.earningsTrend?.trend;
  const next = Array.isArray(trendRows) ? trendRows[0] : null;
  const epsTrend = next?.epsTrend ?? null;
  const epsRevisions = next?.epsRevisions ?? null;

  const current = typeof epsTrend?.current === "number" ? epsTrend.current : null;
  const d30 = typeof epsTrend?.["30daysAgo"] === "number" ? epsTrend["30daysAgo"] : null;
  const d90 = typeof epsTrend?.["90daysAgo"] === "number" ? epsTrend["90daysAgo"] : null;

  const pct30 =
    current != null && d30 != null && Math.abs(d30) > 0
      ? ((current - d30) / Math.abs(d30)) * 100
      : null;
  const pct90 =
    current != null && d90 != null && Math.abs(d90) > 0
      ? ((current - d90) / Math.abs(d90)) * 100
      : null;

  const up30 = typeof epsRevisions?.upLast30days === "number" ? epsRevisions.upLast30days : 0;
  const down30 = typeof epsRevisions?.downLast30days === "number" ? epsRevisions.downLast30days : 0;
  const revisionBalance30d = up30 - down30;

  return {
    earningsEstimateCurrent: current,
    earningsEstimateDelta30dPct: pct30,
    earningsEstimateDelta90dPct: pct90,
    revisionBalance30d,
  };
}

function daysUntil(dateValue: unknown) {
  if (!dateValue) return null;
  const date = new Date(dateValue as string | number | Date);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export async function gatherStockData(symbol: string) {
  const { getHistoricalPrices, getMarketQuote, getMarketSummary } =
    await import("../lib/market-data");

  const period1 = new Date();
  period1.setDate(period1.getDate() - 150);
  const period2 = new Date();

  const [quote, summary] = await Promise.all([getMarketQuote(symbol), getMarketSummary(symbol)]);

  const sector = summary?.assetProfile?.sector ?? null;
  const sectorBenchmark = sectorBenchmarkSymbol(sector);

  const [historical, marketBenchmarkRaw, sectorBenchmarkRaw] = await Promise.all([
    getHistoricalPrices(symbol, { period1, period2, interval: "1d" }).catch(() => []),
    getHistoricalPrices("SPY", { period1, period2, interval: "1d" }).catch(() => []),
    sectorBenchmark
      ? getHistoricalPrices(sectorBenchmark, { period1, period2, interval: "1d" }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const financialData = summary?.financialData ?? null;
  const defaultKeyStatistics = summary?.defaultKeyStatistics ?? null;
  const revisionTrend = revisionTrendFromEarnings(summary);

  const hist = historical
    .filter((h: any) => h.close != null && h.date != null)
    .map((h: any) => ({ date: new Date(h.date), close: h.close as number }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const marketBenchmarkHist = marketBenchmarkRaw
    .filter((h: any) => h.close != null && h.date != null)
    .map((h: any) => ({ date: new Date(h.date), close: h.close as number }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const sectorBenchmarkHist = sectorBenchmarkRaw
    .filter((h: any) => h.close != null && h.date != null)
    .map((h: any) => ({ date: new Date(h.date), close: h.close as number }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const closes = hist.map((h) => h.close);
  const marketBenchmarkCloses = marketBenchmarkHist.map((h) => h.close);
  const sectorBenchmarkCloses = sectorBenchmarkHist.map((h) => h.close);
  const volumes = (historical as any[]).map((h: any) => h.volume).filter(Boolean) as number[];

  const sma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;

  const ema21DailyArr = ema(closes, 21);
  const ema21Daily = ema21DailyArr.length ? ema21DailyArr[ema21DailyArr.length - 1] : null;

  function getWeeklyCloses(hist: Array<{ date: Date; close: number }>): number[] {
    const weeks = new Map<string, number>();
    for (const h of hist) {
      const d = h.date;
      const year = d.getFullYear();
      const jan1 = new Date(year, 0, 1);
      const day = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
      const week = Math.floor(day / 7);
      weeks.set(`${year}-W${week}`, h.close);
    }
    return Array.from(weeks.values());
  }

  const weeklyCloses = getWeeklyCloses(hist);
  const weeklyEma21Arr = ema(weeklyCloses, 21);
  const weeklyEma21 = weeklyEma21Arr.length ? weeklyEma21Arr[weeklyEma21Arr.length - 1] : null;

  const recentVol = volumes.length >= 5 ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : 0;
  const olderVol =
    volumes.length >= 20 ? volumes.slice(-20, -5).reduce((a, b) => a + b, 0) / 15 : recentVol;
  const volumeTrend = olderVol > 0 ? ((recentVol - olderVol) / olderVol) * 100 : 0;
  const priceNow: number = quote.regularMarketPrice ?? 0;
  const price5d = closes[closes.length - 6] ?? priceNow;
  const price20d = closes[closes.length - 21] ?? priceNow;
  const relativeStrengthVsMarket20d = relativeReturn(closes, marketBenchmarkCloses, 20);
  const relativeStrengthVsMarket60d = relativeReturn(closes, marketBenchmarkCloses, 60);
  const relativeStrengthVsSector20d = sectorBenchmarkCloses.length
    ? relativeReturn(closes, sectorBenchmarkCloses, 20)
    : null;
  const relativeStrengthVsSector60d = sectorBenchmarkCloses.length
    ? relativeReturn(closes, sectorBenchmarkCloses, 60)
    : null;

  const earningsDate = summary?.calendarEvents?.earnings?.earningsDate?.[0] ?? null;
  const daysToEarnings = daysUntil(earningsDate);
  const earningsEventRisk =
    daysToEarnings == null
      ? "unknown"
      : daysToEarnings < 0
        ? "passed"
        : daysToEarnings <= 7
          ? "imminent"
          : daysToEarnings <= 21
            ? "near"
            : "clear";

  return {
    symbol,
    companyName: quote.longName ?? quote.shortName ?? symbol,
    businessSummary: summary?.assetProfile?.longBusinessSummary ?? null,
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
    ema21Daily,
    weeklyEma21,
    volumeTrend,
    momentum5d: price5d > 0 ? ((priceNow - price5d) / price5d) * 100 : 0,
    momentum20d: price20d > 0 ? ((priceNow - price20d) / price20d) * 100 : 0,
    priceVsSMA20: sma20 ? ((priceNow - sma20) / sma20) * 100 : null,
    priceVsSMA50: sma50 ? ((priceNow - sma50) / sma50) * 100 : null,
    priceVsEMA21: ema21Daily ? ((priceNow - ema21Daily) / ema21Daily) * 100 : null,
    priceVsWeeklyEMA21: weeklyEma21 ? ((priceNow - weeklyEma21) / weeklyEma21) * 100 : null,
    relativeStrengthVsMarket20d,
    relativeStrengthVsMarket60d,
    relativeStrengthVsSector20d,
    relativeStrengthVsSector60d,
    sectorBenchmark,
    earningsDate,
    daysToEarnings,
    earningsEventRisk,
    revenueGrowth: financialData?.revenueGrowth ?? null,
    earningsGrowth:
      financialData?.earningsGrowth ?? defaultKeyStatistics?.earningsQuarterlyGrowth ?? null,
    profitMargin: financialData?.profitMargins ?? null,
    operatingMargin: financialData?.operatingMargins ?? null,
    grossMargin: financialData?.grossMargins ?? null,
    returnOnEquity: financialData?.returnOnEquity ?? defaultKeyStatistics?.returnOnEquity ?? null,
    returnOnAssets: financialData?.returnOnAssets ?? defaultKeyStatistics?.returnOnAssets ?? null,
    debtToEquity: financialData?.debtToEquity ?? null,
    ebitda: financialData?.ebitda ?? null,
    ebitdaMargin: financialData?.ebitdaMargins ?? null,
    operatingCashflow: financialData?.operatingCashflow ?? null,
    currentRatio: financialData?.currentRatio ?? null,
    quickRatio: financialData?.quickRatio ?? null,
    freeCashflow: financialData?.freeCashflow ?? null,
    sharesOutstanding: quote.sharesOutstanding ?? defaultKeyStatistics?.sharesOutstanding ?? null,
    ...revisionTrend,
    sector: summary?.assetProfile?.sector ?? null,
    industry: summary?.assetProfile?.industry ?? null,
  };
}

type StockData = Awaited<ReturnType<typeof gatherStockData>>;

// ─── AI prompt ────────────────────────────────────────────────────────────────

/**
 * Structured messages for every AI call.
 * `system` is 100% static → Moonshot AI auto-caches it after the first request (0.25× price on reads).
 * `user` is per-symbol dynamic data only.
 */
export type AIMessages = { system: string; user: string };

// Static system prompt — identical across all symbols and all calls.
// OpenRouter sticky-routes by hashing the first system message, so all requests
// hit the same Moonshot AI endpoint and benefit from cached prefix tokens.
const ANALYSIS_SYSTEM_PROMPT = `You are a desruptive equity analyst witch investigates present and future demand to predict tomorrow winners.
Your job: produce a structured multi-section response. Follow the format exactly — no markdown fences, no extra commentary.

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

PRIMARY JOB FOR THE LONG-TERM THESIS:
- Map demand shock -> bottleneck/scarcity -> pricing or utilization -> earnings revisions -> equity repricing.
- Optimize for asymmetry and consensus error, not for picking the prettiest company on traditional ratios.
- Great slow compounders are not automatically the best opportunities. A messy company with scarce, load-bearing exposure can deserve a high opportunityScore.
- Treat fundamentals as a durability and fragility layer underneath the surface. Use them to judge survivability, dilution risk, and whether the company can actually capture the wave.
- Do NOT automatically dismiss a bottleneck winner because trailing margins, valuation, or balance-sheet optics are mediocre. Only let weak fundamentals dominate if they threaten survival or the ability to monetize demand.
- When discussing upside or downside, think in scenario ranges and transmission paths, not vague adjectives.

STRATEGY SETUP (evaluate and include in SIGNAL_JSON):
1. Weekly trend — is price in a weekly uptrend above the 21-week EMA?
2. Pullback to 21 EMA — has price pulled back to or consolidated around the daily 21 EMA?
3. Consolidation breakout near 21 EMA — is there a strong daily candle breaking above recent consolidation/high away from the 21 EMA?

RECONCILE SETUP, THESIS, AND FUNDAMENTALS:
- weeklyCall is allowed to be tactical.
- opportunityScore should primarily reflect demand acceleration, bottleneck power, scarcity, and estimate-revision potential.
- Fundamentals should modulate confidence, fragility, and time horizon more than raw upside.
- If the near-term setup is bullish while revenue / cash flow / debt / valuation look weak, you may still return BUY only as a tactical setup: lower confidence, say clearly that it is a shorter-term timing call, and mention the weak fundamentals in keyBearishFactors and reasoning.
- If the long-term bottleneck thesis is strong despite mediocre trailing fundamentals, say explicitly what traditional metrics are missing and why the company could still reprice hard.
- If fundamentals look decent but the setup is weak, you may still return SELL for now: explain that it is a timing / risk-management call, not a claim that the business is bad, and mention the stronger fundamentals in keyBullishFactors or reasoning.
- Do not present the current signal as a broad business verdict when the evidence is mixed.
────────────────────────────────────────────────────────────────

Respond with EXACTLY these three sections, nothing else:

1. OPPORTUNITY_JSON:
Domain expert lens: secular trends, dependency chains, demand gaps, adoption curves, scarcity, and regime shifts. Start from the physical/economic world, not valuation screens. Be specific about what the company actually sells, who buys it, and why that position could become load-bearing. Quantify 2-3 demand-to-equity scenarios so the output explicitly answers: if X demand rises, how could earnings and the stock react? Use null only when you genuinely cannot estimate. confidence should reflect your conviction in the long-term thesis over the stated horizon, not the weekly setup.
{"secularBet":"<2-sentence thesis about where the world is going and why this company is positioned for it>","dependencyChain":["<If A grows, B must also grow, company owns C of that chain>"],"bottleneckRole":"<what scarce node, chokepoint, or irreplaceable role the company controls; 'none' if no real bottleneck>","consensusBlindSpot":"<what standard fundamental models or common narratives are likely missing>","demandGap":"<where current capacity/infrastructure sits vs. projected need in 2-5 years>","demandScenarios":[{"case":"bear"|"base"|"bull","demandDriver":"<what demand source changes>","demandChangePct":<number|null>,"businessTransmission":"<how that demand change reaches utilization / backlog / pricing / EPS>","earningsImpactPct":<number|null>,"equityImpactPct":<number|null>,"confidence":<0-100>}],"repricingTriggers":["<observable event that could force estimates higher/lower>","<second trigger>"],"sCurvePosition":"early_adopter"|"crossing_chasm"|"mainstream"|"mature","timeHorizon":"2y"|"5y"|"10y+","loadBearingAssumptions":["<must be true for thesis to hold>","<second assumption>"],"falsificationSignals":["<observable event that would break the thesis>","<second signal>"],"opportunityScore":<0-100>,"confidence":<0-100>}

2. SIGNAL_JSON:
weeklyCall is the agentic weekly action to show users. Use BUY when the weekly setup is actionable, SELL when the weekly setup is clearly defensive, and WAIT when the evidence is too mixed or weak to press despite a directional lean in signal.
weeklyOutlook and reasoning are user-facing copy. Keep them plain, simple, and non-technical. Do NOT mention EMA, relative strength, revision balance, percentages, timeframe labels, or indicator names in prose. Use those metrics only in the background to decide whether the short-term setup looks promising, mixed, or weak.
weeklyOutlook should answer one simple question: does the short-term setup look promising right now or not?
{"signal":"BUY"|"SELL","weeklyCall":"BUY"|"SELL"|"WAIT","cycle":"ACCUMULATION"|"MARKUP"|"DISTRIBUTION"|"MARKDOWN","cycleTimeframe":"SHORT"|"MEDIUM"|"LONG","cycleStrength":<0-100>,"confidence":<0-100>,"weeklyOutlook":"<1-2 short plain-language sentences>","keyBullishFactors":["<f>","<f>","<f>"],"keyBearishFactors":["<f>","<f>","<f>"],"riskLevel":"LOW"|"MEDIUM"|"HIGH","priceTarget":<number|null>,"stopLoss":<number|null>,"reasoning":"<2-3 short plain-language sentences>","signalChanged":<boolean>,"weeklyTrend":"uptrend"|"downtrend"|"sideways","pullbackTo21EMA":<boolean>,"consolidationBreakout21EMA":<boolean>}

3. MEMORY_UPDATE:
<updated full memory markdown — include today's signal, cycle, opportunity score, bottleneck role, demand->earnings->equity map, and any new observations>`;

const JSON_ONLY_SYSTEM_PROMPT = `You are an expert stock analyst. Return ONLY one valid JSON object. No markdown fences. No prose.
If near-term setup diverges from fundamentals, explain that clearly in reasoning and lower confidence. Treat signals as timing calls, not blanket business verdicts. For weekly timing, do not confuse "great company" with "best opportunity"; use fundamentals mainly to judge fragility and durability, not to erase genuine demand/bottleneck setups.
weeklyOutlook and reasoning are user-facing copy. Keep them plain, simple, and non-technical. Do NOT mention EMA, relative strength, revision balance, percentages, timeframe labels, or indicator names in prose. Use those metrics only in the background to decide whether the short-term setup looks promising, mixed, or weak.

Required JSON (signal is BUY or SELL only, no HOLD/STRONG variants; weeklyCall may be BUY, SELL, or WAIT):
{"signal":"BUY"|"SELL","weeklyCall":"BUY"|"SELL"|"WAIT","cycle":"ACCUMULATION"|"MARKUP"|"DISTRIBUTION"|"MARKDOWN","cycleTimeframe":"SHORT"|"MEDIUM"|"LONG","cycleStrength":<0-100>,"confidence":<0-100>,"weeklyOutlook":"<1-2 short plain-language sentences>","keyBullishFactors":["<f>","<f>","<f>"],"keyBearishFactors":["<f>","<f>","<f>"],"riskLevel":"LOW"|"MEDIUM"|"HIGH","priceTarget":<number|null>,"stopLoss":<number|null>,"reasoning":"<2-3 short plain-language sentences>","signalChanged":<boolean>,"weeklyTrend":"uptrend"|"downtrend"|"sideways","pullbackTo21EMA":<boolean>,"consolidationBreakout21EMA":<boolean>}`;

export function buildPrompt(
  d: StockData,
  memory: string,
  setupContext: string,
  isDaily: boolean,
  analysisDate: string,
): AIMessages {
  const fmt = (n: number | null | undefined, dec = 2) => (n != null ? n.toFixed(dec) : "N/A");

  const user = `## STOCK MEMORY (accumulated context)
${memory}

## SETUP CONTEXT
${setupContext}

## CURRENT MARKET DATA
STOCK: ${d.symbol} | COMPANY: ${d.companyName ?? d.symbol} | SECTOR: ${d.sector ?? "Unknown"} | INDUSTRY: ${d.industry ?? "Unknown"}
BUSINESS SUMMARY: ${d.businessSummary ?? "N/A"}
PRICE: $${fmt(d.currentPrice)} (${fmt(d.dayChange)}% today) | 52W: $${fmt(d.fiftyTwoWeekLow)}–$${fmt(d.fiftyTwoWeekHigh)}
MARKET CAP: ${d.marketCap ? "$" + (d.marketCap / 1e9).toFixed(1) + "B" : "N/A"} | BETA: ${fmt(d.beta)}
Daily 21 EMA: $${fmt(d.ema21Daily)} (${fmt(d.priceVsEMA21)}% vs price)
Weekly 21 EMA: $${fmt(d.weeklyEma21)} (${fmt(d.priceVsWeeklyEMA21)}% vs price)
MOMENTUM: 5d ${fmt(d.momentum5d)}% | 20d ${fmt(d.momentum20d)}% | Vol trend ${fmt(d.volumeTrend, 1)}%
RELATIVE STRENGTH: vs SPY 20d ${fmt(d.relativeStrengthVsMarket20d, 1)} pts | vs SPY 60d ${fmt(d.relativeStrengthVsMarket60d, 1)} pts | vs sector (${d.sectorBenchmark ?? "N/A"}) 20d ${fmt(d.relativeStrengthVsSector20d, 1)} pts
P/E: ${fmt(d.peRatio, 1)} | Fwd P/E: ${fmt(d.forwardPE, 1)} | D/E: ${fmt(d.debtToEquity, 1)}
Profit margin: ${d.profitMargin != null ? (d.profitMargin * 100).toFixed(1) + "%" : "N/A"} | Op margin: ${d.operatingMargin != null ? (d.operatingMargin * 100).toFixed(1) + "%" : "N/A"} | Gross margin: ${d.grossMargin != null ? (d.grossMargin * 100).toFixed(1) + "%" : "N/A"}
ROE: ${d.returnOnEquity != null ? (d.returnOnEquity * 100).toFixed(1) + "%" : "N/A"} | ROA: ${d.returnOnAssets != null ? (d.returnOnAssets * 100).toFixed(1) + "%" : "N/A"} | Earnings growth: ${d.earningsGrowth != null ? (d.earningsGrowth * 100).toFixed(1) + "%" : "N/A"}
Debt service: EBITDA ${d.ebitda ? "$" + (d.ebitda / 1e9).toFixed(2) + "B" : "N/A"} | Op cash ${d.operatingCashflow ? "$" + (d.operatingCashflow / 1e9).toFixed(2) + "B" : "N/A"} | Current ratio ${fmt(d.currentRatio, 1)} | Quick ratio ${fmt(d.quickRatio, 1)}
Revision trend: est vs 30d ${fmt(d.earningsEstimateDelta30dPct, 1)}% | est vs 90d ${fmt(d.earningsEstimateDelta90dPct, 1)}% | rev balance 30d ${fmt(d.revisionBalance30d, 0)}
Revenue growth: ${d.revenueGrowth != null ? (d.revenueGrowth * 100).toFixed(1) + "%" : "N/A"} | FCF: ${d.freeCashflow ? "$" + (d.freeCashflow / 1e9).toFixed(2) + "B" : "N/A"} | Shares out: ${d.sharesOutstanding ? (d.sharesOutstanding / 1e6).toFixed(1) + "M" : "N/A"}
Next earnings: ${d.earningsDate ? new Date(d.earningsDate).toDateString() : "N/A"} | Days to earnings: ${fmt(d.daysToEarnings, 0)} | Earnings event risk: ${d.earningsEventRisk ?? "N/A"}

${
  isDaily
    ? `CONTEXT: Daily update as of ${analysisDate}. Only set signalChanged=true if something material shifted.`
    : `CONTEXT: Shared analysis as of ${analysisDate}.`
}`;
  return { system: ANALYSIS_SYSTEM_PROMPT, user };
}

export function buildJsonOnlyRetryPrompt(
  d: StockData,
  setupContext: string,
  isDaily: boolean,
  analysisDate: string,
): AIMessages {
  const fmt = (n: number | null | undefined, dec = 2) => (n != null ? n.toFixed(dec) : "N/A");
  const user = `STOCK: ${d.symbol} | COMPANY: ${d.companyName ?? d.symbol} | PRICE: $${fmt(d.currentPrice)} (${fmt(d.dayChange)}% today)
BUSINESS SUMMARY: ${d.businessSummary ?? "N/A"}
Daily 21 EMA: $${fmt(d.ema21Daily)} (${fmt(d.priceVsEMA21)}% vs price)
Weekly 21 EMA: $${fmt(d.weeklyEma21)} (${fmt(d.priceVsWeeklyEMA21)}% vs price)
MOMENTUM: 5d ${fmt(d.momentum5d)}% | 20d ${fmt(d.momentum20d)}% | Vol trend ${fmt(d.volumeTrend, 1)}%
RELATIVE STRENGTH: vs SPY 20d ${fmt(d.relativeStrengthVsMarket20d, 1)} pts | vs sector 20d ${fmt(d.relativeStrengthVsSector20d, 1)} pts
P/E: ${fmt(d.peRatio, 1)} | D/E: ${fmt(d.debtToEquity, 1)} | ROE: ${d.returnOnEquity != null ? (d.returnOnEquity * 100).toFixed(1) + "%" : "N/A"} | ROA: ${d.returnOnAssets != null ? (d.returnOnAssets * 100).toFixed(1) + "%" : "N/A"}
Op margin: ${d.operatingMargin != null ? (d.operatingMargin * 100).toFixed(1) + "%" : "N/A"} | Gross margin: ${d.grossMargin != null ? (d.grossMargin * 100).toFixed(1) + "%" : "N/A"} | Earnings growth: ${d.earningsGrowth != null ? (d.earningsGrowth * 100).toFixed(1) + "%" : "N/A"}
Debt service: EBITDA ${d.ebitda ? "$" + (d.ebitda / 1e9).toFixed(2) + "B" : "N/A"} | Op cash ${d.operatingCashflow ? "$" + (d.operatingCashflow / 1e9).toFixed(2) + "B" : "N/A"} | Current ratio ${fmt(d.currentRatio, 1)}
Revision trend: est vs 30d ${fmt(d.earningsEstimateDelta30dPct, 1)}% | rev balance 30d ${fmt(d.revisionBalance30d, 0)} | Days to earnings ${fmt(d.daysToEarnings, 0)}
SETUP CONTEXT: ${setupContext}
CONTEXT: ${isDaily ? `Daily update as of ${analysisDate}.` : `Shared analysis as of ${analysisDate}.`}`;
  return { system: JSON_ONLY_SYSTEM_PROMPT, user };
}

// ─── AI call ──────────────────────────────────────────────────────────────────

const DEFAULT_AI_TIMEOUT_MS = 300_000; // Match the VPS proxy response budget unless explicitly overridden.
const AI_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.AI_TIMEOUT_MS ?? DEFAULT_AI_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AI_TIMEOUT_MS;
})();
const AI_TIMEOUT_SECONDS = Math.ceil(AI_TIMEOUT_MS / 1_000);
const AI_MAX_OUTPUT_TOKENS = 8_000; // Leaves ample room for the full structured payload.
const AI_REASONING = { effort: "none" as const }; // Kimi 2.6 is much faster/cheaper here without hidden reasoning burn.
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type AIUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  model: string;
};

export type AIStreamChunk =
  | { type: "delta"; delta: string }
  | { type: "usage"; usage: AIUsage }
  | { type: "warning"; warning: string };

export class AIRequestAbortedError extends Error {
  constructor() {
    super("AI request aborted");
    this.name = "AIRequestAbortedError";
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}

function createAIRequestSignal(externalSignal?: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(AI_TIMEOUT_MS);
  return {
    signal: externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal,
    timeoutSignal,
  };
}

function rethrowAIAbort(
  error: unknown,
  timeoutSignal: AbortSignal,
  externalSignal?: AbortSignal,
): never {
  if (!isAbortError(error)) throw error;
  if (timeoutSignal.aborted) {
    throw new Error(`AI call timed out after ${AI_TIMEOUT_SECONDS}s`);
  }
  if (externalSignal?.aborted) {
    throw new AIRequestAbortedError();
  }
  throw error;
}

function numberOrThrow(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`OpenRouter response missing ${label}`);
}

function getOpenRouterAttributionHeaders() {
  const referer = process.env.OPENROUTER_HTTP_REFERER ?? process.env.BETTER_AUTH_URL;
  const title = process.env.OPENROUTER_APP_TITLE ?? "Bursa";

  return {
    ...(referer ? { "HTTP-Referer": referer } : {}),
    "X-OpenRouter-Title": title,
  };
}

async function createOpenRouterClient() {
  const { default: OpenAI } = await import("openai");
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: getOpenRouterAttributionHeaders(),
  });
}

function requireVisibleText(text: string, reason?: string | null) {
  if (!text.trim()) {
    throw new Error(
      reason
        ? `OpenRouter completed without visible output text (${reason})`
        : "OpenRouter completed without visible output text",
    );
  }
  return text;
}

/** Fallback cost estimate when OpenRouter omits `usage.cost` in a streaming chunk.
 * Uses Kimi K2.6 non-cached rates ($0.20/M prompt + $0.20/M completion)
 * so we never undercharge. A warning is yielded so the client knows.
 */
function estimateCostFromTokens(promptTokens: number, completionTokens: number): number {
  const ratePerToken = 0.2 / 1_000_000; // $0.20 per million tokens
  return (promptTokens + completionTokens) * ratePerToken;
}

function extractUsageFromResponse(response: any): AIUsage {
  const usage = response?.usage;
  if (!usage) throw new Error("OpenRouter response missing usage");

  const promptTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const completionTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const totalTokens =
    Number(usage.total_tokens ?? promptTokens + completionTokens) ||
    promptTokens + completionTokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: numberOrThrow(usage.cost, "usage.cost"),
    model: response?.model ?? AI_MODEL,
  };
}

function mergeUsages(usages: AIUsage[]): AIUsage {
  if (usages.length === 0) {
    throw new Error("No OpenRouter usage records to merge");
  }

  return usages.reduce(
    (merged, usage) => ({
      promptTokens: merged.promptTokens + usage.promptTokens,
      completionTokens: merged.completionTokens + usage.completionTokens,
      totalTokens: merged.totalTokens + usage.totalTokens,
      costUsd: merged.costUsd + usage.costUsd,
      model: usage.model || merged.model,
    }),
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      model: AI_MODEL,
    },
  );
}

/** Call AI and return text + usage/cost metadata. System message is static and prompt-cached by Moonshot AI. */
export async function callAIWithUsage(
  messages: AIMessages,
  options: { signal?: AbortSignal } = {},
): Promise<{ text: string; usage: AIUsage }> {
  const client = await createOpenRouterClient();
  const { signal, timeoutSignal } = createAIRequestSignal(options.signal);

  try {
    const response = await (client.chat.completions.create as any)(
      {
        model: AI_MODEL,
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
        reasoning: AI_REASONING,
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        stream: false,
      },
      { signal },
    );

    const text = response.choices?.[0]?.message?.content ?? "";
    return {
      text: requireVisibleText(text),
      usage: extractUsageFromResponse(response),
    };
  } catch (error) {
    rethrowAIAbort(error, timeoutSignal, options.signal);
  }
}

/** Stream AI response with text deltas and final usage metadata. System message is static and prompt-cached by Moonshot AI. */
export async function* callAIStream(
  messages: AIMessages,
  options: { signal?: AbortSignal } = {},
): AsyncIterable<AIStreamChunk> {
  const client = await createOpenRouterClient();
  const { signal, timeoutSignal } = createAIRequestSignal(options.signal);

  let usageChunk: any = null;
  let sawTextDelta = false;
  let finishReason: string | null = null;

  try {
    const stream = await (client.chat.completions.create as any)(
      {
        model: AI_MODEL,
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
        reasoning: AI_REASONING,
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal },
    );

    for await (const chunk of stream as AsyncIterable<any>) {
      // Final chunk carries usage when stream_options.include_usage=true
      if (chunk.usage) {
        usageChunk = chunk;
      }

      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        sawTextDelta = true;
        yield { type: "delta", delta };
      }

      const reason = chunk.choices?.[0]?.finish_reason;
      if (reason) {
        finishReason = reason;
      }
    }

    if (!usageChunk) {
      if (sawTextDelta) {
        yield {
          type: "warning",
          warning:
            "OpenRouter ended the stream before sending final response metadata. Partial analysis was preserved, but usage/cost data was unavailable, so this run was not billed or auto-saved.",
        };
        return;
      }
      throw new Error("OpenRouter stream finished without any content or usage data");
    }

    if (!sawTextDelta) {
      throw new Error(
        finishReason
          ? `OpenRouter completed without visible output text (${finishReason})`
          : "OpenRouter completed without visible output text",
      );
    }

    // Defensive: OpenRouter sometimes omits usage.cost in the streaming final chunk.
    // Patch in a token-based estimate so billing never crashes on a completed stream.
    if (
      usageChunk.usage &&
      (usageChunk.usage.cost == null || Number.isNaN(usageChunk.usage.cost))
    ) {
      const pt = Number(usageChunk.usage.prompt_tokens ?? 0) || 0;
      const ct = Number(usageChunk.usage.completion_tokens ?? 0) || 0;
      usageChunk.usage.cost = estimateCostFromTokens(pt, ct);
      yield {
        type: "warning",
        warning: `OpenRouter did not report usage.cost in the streaming chunk. Billed using an estimated cost (${usageChunk.usage.cost.toFixed(6)} USD) derived from token counts.`,
      };
    }

    yield { type: "usage", usage: extractUsageFromResponse(usageChunk) };
  } catch (error) {
    rethrowAIAbort(error, timeoutSignal, options.signal);
  }
}

export async function chargeUserForUsage(
  db: Awaited<ReturnType<typeof import("../lib/db").getDb>>,
  userId: string,
  symbol: string,
  usage: AIUsage,
) {
  const { user, usageLog } = await import("../lib/schema");
  const { getUsdToEurRate } = await import("../lib/fx");

  const billing = calculateBilledCost({
    actualModel: usage.model,
    providerCostUsd: usage.costUsd,
    usdToEurRate: await getUsdToEurRate(),
  });

  const [u] = await db
    .select({ walletBalance: user.walletBalance })
    .from(user)
    .where(eq(user.id, userId));

  await db
    .update(user)
    .set({ walletBalance: Math.max(0, (u?.walletBalance ?? 0) - billing.billedCents) })
    .where(eq(user.id, userId));

  await db.insert(usageLog).values({
    userId,
    symbol,
    model: billing.actualModel,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    providerCostUsd: billing.providerCostUsd,
    costCents: billing.billedCents,
    createdAt: new Date(),
  });

  return billing;
}

// ─── Memory helpers ───────────────────────────────────────────────────────────

export async function readMemory(symbol: string): Promise<string> {
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  const [row] = await db.select().from(stockMemory).where(eq(stockMemory.symbol, symbol));
  return row?.content ?? buildInitialMemory(symbol);
}

export async function writeMemory(symbol: string, content: string) {
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

// ─── Parse full AI response ───────────────────────────────────────────────────

function parseFullResponse(raw: string): {
  signal: Omit<RecommendationResult, "id" | "priceAtAnalysis" | "analysisDate">;
  opportunityJson: Record<string, unknown> | null;
  memoryUpdate: string | null;
} {
  const {
    signalJson,
    opportunityJson: rawOpportunityJson,
    memoryUpdate,
  } = parseStructuredResponse(raw);

  if (!signalJson) throw new Error(`No SIGNAL_JSON found in response: ${raw.slice(0, 300)}`);

  const signal = parseAiJson<any>(signalJson);

  let opportunityJson: Record<string, unknown> | null = null;
  if (rawOpportunityJson) {
    try {
      opportunityJson = parseAiJson<Record<string, unknown>>(rawOpportunityJson);
    } catch {
      // Non-fatal — opportunity optional
    }
  }

  return { signal, opportunityJson, memoryUpdate };
}

async function buildPersistedThesisJson(
  symbol: string,
  parsedSignal: any,
  stockData: StockData,
  options?: { hasExtremeRisk?: boolean; macroThesis?: Record<string, unknown> | null },
) {
  const [{ buildStockThesis, STOCK_THESIS_VERSION }, { getSimpleAnalysisForSymbol }] =
    await Promise.all([import("../lib/stock-thesis"), import("./stocks")]);

  const simpleAnalysis = await getSimpleAnalysisForSymbol(symbol).catch(() => null);

  let macroThesis = null;
  if (options?.macroThesis) {
    const { parseMacroThesis } = await import("../lib/simple-analysis");
    macroThesis = parseMacroThesis(JSON.stringify(options.macroThesis));
  }

  const thesis = buildStockThesis(
    {
      signal: parsedSignal.signal as "BUY" | "SELL",
      cycle: parsedSignal.cycle ?? null,
      cycleTimeframe: parsedSignal.cycleTimeframe ?? null,
      confidence: parsedSignal.confidence ?? null,
      riskLevel: parsedSignal.riskLevel,
      weeklyTrend: parsedSignal.weeklyTrend,
      pullbackTo21EMA: parsedSignal.pullbackTo21EMA,
      consolidationBreakout21EMA: parsedSignal.consolidationBreakout21EMA,
      weeklyOutlook: parsedSignal.weeklyOutlook,
      reasoning: parsedSignal.reasoning,
      keyBullishFactors: parsedSignal.keyBullishFactors,
      keyBearishFactors: parsedSignal.keyBearishFactors,
      relativeStrengthVsMarket20d: stockData.relativeStrengthVsMarket20d ?? null,
      relativeStrengthVsSector20d: stockData.relativeStrengthVsSector20d ?? null,
      daysToEarnings: stockData.daysToEarnings ?? null,
      earningsEventRisk: stockData.earningsEventRisk ?? null,
      earningsEstimateDelta30dPct: stockData.earningsEstimateDelta30dPct ?? null,
      earningsEstimateDelta90dPct: stockData.earningsEstimateDelta90dPct ?? null,
      revisionBalance30d: stockData.revisionBalance30d ?? null,
    },
    simpleAnalysis,
    { hasExtremeRisk: options?.hasExtremeRisk, macroThesis },
  );

  return {
    simpleAnalysisJson: simpleAnalysis ? JSON.stringify(simpleAnalysis) : null,
    thesisJson: thesis ? JSON.stringify(thesis) : null,
    thesisVersion: thesis?.version ?? STOCK_THESIS_VERSION,
  };
}

// ─── Shared save logic (used by stream handler + saveWeeklyAnalysis) ────────────

/**
 * Persists a completed AI analysis to the DB.
 * Accepts pre-fetched stockData so callers don't need an extra Yahoo Finance round-trip.
 * Returns the upserted analysis ID.
 */
export async function saveAnalysisFromStreamedText({
  db,
  symbol,
  rawText,
  stockData,
  userId,
  analysisDate,
}: {
  db: Awaited<ReturnType<typeof import("../lib/db").getDb>>;
  symbol: string;
  rawText: string;
  stockData: Awaited<ReturnType<typeof gatherStockData>>;
  userId: string;
  analysisDate: string;
}): Promise<string> {
  let parsed: ReturnType<typeof parseFullResponse>;
  try {
    parsed = parseFullResponse(rawText);
  } catch {
    throw new Error("Failed to parse streamed analysis");
  }

  const { signal: parsedSignal, opportunityJson, memoryUpdate } = parsed;

  const { simpleAnalysisJson, thesisJson, thesisVersion } = await buildPersistedThesisJson(
    symbol,
    parsedSignal,
    stockData,
    {
      hasExtremeRisk: false,
      macroThesis: opportunityJson ?? null,
    },
  );

  const recId = randomUUID();
  const now = new Date();

  await db.insert(stockAnalysis).values({
    id: recId,
    symbol,
    analysisDate,
    signal: parsedSignal.signal as Signal,
    cycle: parsedSignal.cycle ?? null,
    cycleTimeframe: parsedSignal.cycleTimeframe ?? null,
    cycleStrength: parsedSignal.cycleStrength ?? null,
    confidence: parsedSignal.confidence,
    reasoning: JSON.stringify(parsedSignal),
    simpleAnalysisJson,
    thesisJson,
    thesisVersion,
    macroThesisJson: opportunityJson ? JSON.stringify(opportunityJson) : null,
    priceAtAnalysis: stockData.currentPrice,
    lastTriggeredByUserId: userId,
    createdAt: now,
    updatedAt: now,
  });

  await db.update(stock).set({ lastAnalyzedAt: now }).where(eq(stock.symbol, symbol));
  if (memoryUpdate) await writeMemory(symbol, memoryUpdate);

  return recId;
}

// ─── Server functions ─────────────────────────────────────────────────────────

export const generateWeeklyAnalysis = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { symbol: string }) => data)
  .handler(async ({ data, context }): Promise<RecommendationResult> => {
    const ctx = (context ?? {}) as {
      session: { sub: string } | null;
      walletBalance: number;
      isAdmin: boolean;
    };
    if (!ctx.session) throw new Error("Unauthorized");

    const MIN_BALANCE_CENTS = 10;
    if (!ctx.isAdmin && (ctx.walletBalance ?? 0) < MIN_BALANCE_CENTS) {
      throw new Error("INSUFFICIENT_FUNDS");
    }

    const { getDb } = await import("../lib/db");
    const db = await getDb();

    const today = new Date();
    const analysisDate = format(today, "yyyy-MM-dd");

    const [stockData, memory] = await Promise.all([
      gatherStockData(data.symbol),
      readMemory(data.symbol),
    ]);

    const setupContext = [
      `Daily 21 EMA: $${stockData.ema21Daily?.toFixed(2) ?? "N/A"} (${stockData.priceVsEMA21?.toFixed(1) ?? "N/A"}% vs price)`,
      `Weekly 21 EMA: $${stockData.weeklyEma21?.toFixed(2) ?? "N/A"} (${stockData.priceVsWeeklyEMA21?.toFixed(1) ?? "N/A"}% vs price)`,
      `Volume trend: ${stockData.volumeTrend?.toFixed(1) ?? "N/A"}%`,
    ].join(" | ");

    const messages = buildPrompt(stockData, memory, setupContext, false, analysisDate);
    const initial = await callAIWithUsage(messages);
    let usage = initial.usage;

    let parsed: ReturnType<typeof parseFullResponse>;
    try {
      parsed = parseFullResponse(initial.text);
    } catch {
      // Fallback: retry for signal JSON only
      const retry = await callAIWithUsage(
        buildJsonOnlyRetryPrompt(stockData, setupContext, false, analysisDate),
      );
      usage = mergeUsages([usage, retry.usage]);
      const signalOnly = parseAiJson<any>(retry.text);
      parsed = {
        signal: signalOnly,
        opportunityJson: null,
        memoryUpdate: null,
      };
    }

    const { signal: parsedSignal, opportunityJson, memoryUpdate } = parsed;
    const { simpleAnalysisJson, thesisJson, thesisVersion } = await buildPersistedThesisJson(
      data.symbol,
      parsedSignal,
      stockData,
      {
        hasExtremeRisk: false,
        macroThesis: opportunityJson ?? null,
      },
    );

    const recId = randomUUID();
    const now = new Date();

    await db.insert(stockAnalysis).values({
      id: recId,
      symbol: data.symbol,
      analysisDate,
      signal: parsedSignal.signal as Signal,
      cycle: parsedSignal.cycle ?? null,
      cycleTimeframe: parsedSignal.cycleTimeframe ?? null,
      cycleStrength: parsedSignal.cycleStrength ?? null,
      confidence: parsedSignal.confidence,
      reasoning: JSON.stringify(parsedSignal),
      simpleAnalysisJson,
      thesisJson,
      thesisVersion,
      macroThesisJson: opportunityJson ? JSON.stringify(opportunityJson) : null,
      priceAtAnalysis: stockData.currentPrice,
      lastTriggeredByUserId: ctx.session.sub,
      createdAt: now,
      updatedAt: now,
    });

    await db.update(stock).set({ lastAnalyzedAt: now }).where(eq(stock.symbol, data.symbol));

    if (memoryUpdate) await writeMemory(data.symbol, memoryUpdate);

    // Deduct billed amount from wallet using OpenRouter actual cost when available.
    if (!ctx.isAdmin) {
      await chargeUserForUsage(db, ctx.session.sub, data.symbol, usage);
    }

    return {
      id: recId,
      ...parsedSignal,
      signal: parsedSignal.signal as Signal,
      cycle: parsedSignal.cycle ?? null,
      cycleTimeframe: parsedSignal.cycleTimeframe ?? null,
      cycleStrength: parsedSignal.cycleStrength ?? null,
      priceAtAnalysis: stockData.currentPrice,
      analysisDate,
    };
  });

export const generateDailyUpdate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { symbol: string; analysisId: string }) => data)
  .handler(async ({ data, context }): Promise<RecommendationResult> => {
    const ctx = (context ?? {}) as {
      session: { sub: string } | null;
      walletBalance: number;
      isAdmin: boolean;
    };
    if (!ctx.session) throw new Error("Unauthorized");

    const MIN_BALANCE_CENTS = 10;
    if (!ctx.isAdmin && (ctx.walletBalance ?? 0) < MIN_BALANCE_CENTS) {
      throw new Error("INSUFFICIENT_FUNDS");
    }

    const { getDb } = await import("../lib/db");
    const db = await getDb();

    const today = new Date();
    const analysisDate = format(today, "yyyy-MM-dd");

    const [analysis] = await db
      .select()
      .from(stockAnalysis)
      .where(eq(stockAnalysis.id, data.analysisId));
    if (!analysis) throw new Error("Analysis not found");

    const [stockData, memory] = await Promise.all([
      gatherStockData(data.symbol),
      readMemory(data.symbol),
    ]);

    const setupContext = [
      `Daily 21 EMA: $${stockData.ema21Daily?.toFixed(2) ?? "N/A"} (${stockData.priceVsEMA21?.toFixed(1) ?? "N/A"}% vs price)`,
      `Weekly 21 EMA: $${stockData.weeklyEma21?.toFixed(2) ?? "N/A"} (${stockData.priceVsWeeklyEMA21?.toFixed(1) ?? "N/A"}% vs price)`,
      `Volume trend: ${stockData.volumeTrend?.toFixed(1) ?? "N/A"}%`,
    ].join(" | ");

    const messages = buildPrompt(stockData, memory, setupContext, true, analysisDate);
    const initial = await callAIWithUsage(messages);
    let usage = initial.usage;

    let parsed: ReturnType<typeof parseFullResponse>;
    try {
      parsed = parseFullResponse(initial.text);
    } catch {
      const retry = await callAIWithUsage(
        buildJsonOnlyRetryPrompt(stockData, setupContext, true, analysisDate),
      );
      usage = mergeUsages([usage, retry.usage]);
      const signalOnly = parseAiJson<any>(retry.text);
      parsed = {
        signal: signalOnly,
        opportunityJson: null,
        memoryUpdate: null,
      };
    }

    const { signal: parsedSignal, opportunityJson, memoryUpdate } = parsed;
    const changed = parsedSignal.signal !== analysis.signal;
    const { simpleAnalysisJson, thesisJson, thesisVersion } = await buildPersistedThesisJson(
      data.symbol,
      parsedSignal,
      stockData,
      {
        hasExtremeRisk: false,
        macroThesis: opportunityJson ?? null,
      },
    );

    const recId = randomUUID();
    const now = new Date();

    await db.insert(stockAnalysis).values({
      id: recId,
      symbol: data.symbol,
      analysisDate,
      signal: parsedSignal.signal as Signal,
      cycle: parsedSignal.cycle ?? null,
      cycleTimeframe: parsedSignal.cycleTimeframe ?? null,
      cycleStrength: parsedSignal.cycleStrength ?? null,
      confidence: parsedSignal.confidence,
      reasoning: JSON.stringify(parsedSignal),
      simpleAnalysisJson,
      thesisJson,
      thesisVersion,
      macroThesisJson: opportunityJson ? JSON.stringify(opportunityJson) : null,
      priceAtAnalysis: stockData.currentPrice,
      lastTriggeredByUserId: ctx.session.sub,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(dailySignal).values({
      id: randomUUID(),
      stockAnalysisId: recId,
      symbol: data.symbol,
      date: analysisDate,
      signal: parsedSignal.signal as Signal,
      cycle: parsedSignal.cycle ?? null,
      note: parsedSignal.reasoning,
      priceAtUpdate: stockData.currentPrice,
      signalChanged: changed,
      trigger: "manual",
      createdAt: now,
    });

    if (memoryUpdate) await writeMemory(data.symbol, memoryUpdate);

    // Deduct billed amount from wallet using OpenRouter actual cost when available.
    if (!ctx.isAdmin) {
      await chargeUserForUsage(db, ctx.session.sub, data.symbol, usage);
    }

    return {
      id: recId,
      ...parsedSignal,
      signal: parsedSignal.signal as Signal,
      cycle: parsedSignal.cycle ?? null,
      cycleTimeframe: parsedSignal.cycleTimeframe ?? null,
      cycleStrength: parsedSignal.cycleStrength ?? null,
      signalChanged: changed,
      priceAtAnalysis: stockData.currentPrice,
      analysisDate,
    };
  });

// ─── Save pre-computed analysis (used after streaming) ────────────────────────

export const saveWeeklyAnalysis = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { symbol: string; rawText: string }) => data)
  .handler(async ({ data, context }): Promise<RecommendationResult> => {
    const ctx = (context ?? {}) as {
      session: { sub: string } | null;
      isAdmin: boolean;
    };
    if (!ctx.session) throw new Error("Unauthorized");

    const { getDb } = await import("../lib/db");
    const db = await getDb();

    const today = new Date();
    const analysisDate = format(today, "yyyy-MM-dd");

    const stockData = await gatherStockData(data.symbol);

    const recId = await saveAnalysisFromStreamedText({
      db,
      symbol: data.symbol,
      rawText: data.rawText,
      stockData,
      userId: ctx.session.sub,
      analysisDate,
    });

    // Re-parse just to build the return value the callers expect.
    const parsed = parseFullResponse(data.rawText);
    const { signal: parsedSignal } = parsed;

    return {
      id: recId,
      ...parsedSignal,
      signal: parsedSignal.signal as Signal,
      cycle: parsedSignal.cycle ?? null,
      cycleTimeframe: parsedSignal.cycleTimeframe ?? null,
      cycleStrength: parsedSignal.cycleStrength ?? null,
      priceAtAnalysis: stockData.currentPrice,
      analysisDate,
    };
  });
