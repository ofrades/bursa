import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { TokenUsage } from "@tanstack/ai-event-client";
import { stockAnalysis, stock, stockMemory } from "../lib/schema";
import { buildInitialMemory } from "./memory";
import { ema } from "../lib/metrics";
import { calculateBilledCost } from "../lib/pricing";
import type { AnalysisOutput } from "../lib/analysis-output-schema";
import {
  contextSchema,
  macroThesisSchema,
  signalSchema,
  stockThesisSchema,
} from "../lib/analysis-output-schema";
import type { DividendData } from "../lib/market-data";
import type { SimpleAnalysisEvidence } from "../lib/simple-analysis";
import {
  normalizeAnalysisOutput,
  normalizeParsedAnalysisSections,
} from "../lib/analysis-normalize";
import {
  ANALYSIS_SYSTEM_PROMPT,
  STRUCTURED_ANALYSIS_SYSTEM_PROMPT,
} from "../lib/prompts/analysis-prompts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Signal = "BUY" | "SELL";

// Canonical run-usage shape from @tanstack/ai-event-client 0.25+ — carries
// the provider's real `cost`/`costDetails` (OpenRouter reports this inline per
// request) plus token counts. We add a `costUsd` fallback and `model` so the
// billing layer can use a single type.
export type AIUsage = TokenUsage & {
  // Synthetic USD cost when the provider doesn't report one (older TanStack AI
  // versions, non-OpenRouter adapters). Always populated by the stream layer
  // even when `cost` is also set, so downstream billing code can rely on it.
  costUsd: number;
  model: string;
};

// ─── Yahoo Finance data gathering ─────────────────────────────────────────────

const SECTOR_BENCHMARKS = new Map<string, string>([
  ["technology", "XLK"],
  ["financial services", "XLF"],
  ["healthcare", "XLV"],
  ["consumer cyclical", "XLY"],
  ["consumer defensive", "XLP"],
  ["industrials", "XLI"],
  ["energy", "XLE"],
  ["utilities", "XLU"],
  ["real estate", "XLRE"],
  ["basic materials", "XLB"],
  ["communication services", "XLC"],
]);

function sectorBenchmarkSymbol(sector: string | null | undefined) {
  if (!sector) return null;
  return SECTOR_BENCHMARKS.get(sector.trim().toLowerCase()) ?? null;
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

const optionalNumberSchema = z.number().nullish();

function parseOptionalNumber(value: number | null | undefined): number | null {
  const result = optionalNumberSchema.safeParse(value);
  return result.success ? (result.data ?? null) : null;
}

function revisionTrendFromEarnings(summary: any) {
  const trendRows = summary?.earningsTrend?.trend;
  const next = Array.isArray(trendRows) ? trendRows[0] : null;
  const epsTrend = next?.epsTrend ?? null;
  const epsRevisions = next?.epsRevisions ?? null;

  const current = parseOptionalNumber(epsTrend?.current);
  const d30 = parseOptionalNumber(epsTrend?.["30daysAgo"]);
  const d90 = parseOptionalNumber(epsTrend?.["90daysAgo"]);

  const pct30 =
    current != null && d30 != null && Math.abs(d30) > 0
      ? ((current - d30) / Math.abs(d30)) * 100
      : null;
  const pct90 =
    current != null && d90 != null && Math.abs(d90) > 0
      ? ((current - d90) / Math.abs(d90)) * 100
      : null;

  const up30 = parseOptionalNumber(epsRevisions?.upLast30days) ?? 0;
  const down30 = parseOptionalNumber(epsRevisions?.downLast30days) ?? 0;
  const revisionBalance30d = up30 - down30;

  return {
    earningsEstimateCurrent: current,
    earningsEstimateDelta30dPct: pct30,
    earningsEstimateDelta90dPct: pct90,
    revisionBalance30d,
  };
}

function daysUntil(dateValue: string | number | Date | null | undefined) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
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

export type StockData = Awaited<ReturnType<typeof gatherStockData>>;

export type AnalysisEvidenceSnapshot = {
  simpleAnalysis: SimpleAnalysisEvidence | null;
  dividendData: DividendData | null;
};

export type AnalysisRunSnapshot = AnalysisEvidenceSnapshot & {
  stockData: StockData;
};

async function gatherAnalysisEvidence(symbol: string): Promise<AnalysisEvidenceSnapshot> {
  const [{ getSimpleAnalysisForSymbol }, { getDividendData }] = await Promise.all([
    import("./stocks"),
    import("../lib/market-data"),
  ]);

  const [simpleAnalysis, dividendData] = await Promise.all([
    getSimpleAnalysisForSymbol(symbol).catch(() => null),
    getDividendData(symbol).catch(() => null),
  ]);

  return { simpleAnalysis, dividendData };
}

export async function gatherAnalysisSnapshot(symbol: string): Promise<AnalysisRunSnapshot> {
  const [stockData, evidence] = await Promise.all([
    gatherStockData(symbol),
    gatherAnalysisEvidence(symbol),
  ]);

  return { stockData, ...evidence };
}

export type PriorAnalysisContext = {
  analysisDate: string;
  signal: string;
  weeklyCall?: string | null;
  priceAtAnalysis: number | null;
  weeklyOutlook?: string | null;
};

/**
 * Builds a PRIOR CALL PERFORMANCE block for the user prompt.
 * This is computed from DB data — never from AI memory — so it cannot be
 * soft-pedalled or silently omitted. The model is forced to reckon with the
 * factual outcome of its last call.
 */
function buildPriorCallBlock(prior: PriorAnalysisContext, currentPrice: number): string {
  const pct =
    prior.priceAtAnalysis && prior.priceAtAnalysis > 0
      ? ((currentPrice - prior.priceAtAnalysis) / prior.priceAtAnalysis) * 100
      : null;

  const pctStr = pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "unknown";

  let outcome = "→ minimal price movement (call was roughly neutral)";
  if (pct != null && Math.abs(pct) >= 3) {
    const priceWentUp = pct > 0;
    const calledBullish =
      prior.weeklyCall === "BUY" || (!prior.weeklyCall && prior.signal === "BUY");
    const calledBearish =
      prior.weeklyCall === "SELL" || (!prior.weeklyCall && prior.signal === "SELL");
    if ((calledBullish && priceWentUp) || (calledBearish && !priceWentUp)) {
      outcome = `✓ moved IN the predicted direction (${pctStr})`;
    } else if ((calledBullish && !priceWentUp) || (calledBearish && priceWentUp)) {
      outcome = `✗ moved AGAINST the predicted direction (${pctStr})`;
    }
  }

  const weeklyCallStr = prior.weeklyCall ? ` / weekly: ${prior.weeklyCall}` : "";
  const outlookStr = prior.weeklyOutlook ? `\nPrior reasoning: "${prior.weeklyOutlook}"` : "";

  return `Last call (${prior.analysisDate}): ${prior.signal}${weeklyCallStr} at $${prior.priceAtAnalysis?.toFixed(2) ?? "N/A"}
Outcome since then: ${outcome}${outlookStr}
You MUST fill priorCallAssessment: state specifically what the prior reasoning got right or wrong given this outcome.`;
}

/**
 * Translates raw EMA/volume numbers into plain-language setup labels.
 * This is placed in ## SETUP CONTEXT so the model gets an interpreted signal
 * before the wall of raw numbers in ## CURRENT MARKET DATA.
 */
function describeSetup(d: StockData): string {
  const parts: string[] = [];

  if (d.priceVsEMA21 != null) {
    const abs = Math.abs(d.priceVsEMA21).toFixed(1);
    if (Math.abs(d.priceVsEMA21) <= 2) {
      parts.push(`price near the daily 21 EMA (${d.priceVsEMA21 >= 0 ? "+" : ""}${abs}%)`);
    } else if (d.priceVsEMA21 > 0) {
      parts.push(`price extended ${abs}% above the daily 21 EMA`);
    } else {
      parts.push(`price ${abs}% below the daily 21 EMA`);
    }
  }

  if (d.priceVsWeeklyEMA21 != null) {
    const dir = d.priceVsWeeklyEMA21 > 0 ? "above" : "below";
    parts.push(`${Math.abs(d.priceVsWeeklyEMA21).toFixed(1)}% ${dir} the weekly 21 EMA`);
  }

  if (d.volumeTrend != null) {
    if (d.volumeTrend > 5) parts.push(`volume expanding (+${d.volumeTrend.toFixed(1)}%)`);
    else if (d.volumeTrend < -5) parts.push(`volume contracting (${d.volumeTrend.toFixed(1)}%)`);
    else parts.push(`volume roughly flat`);
  }

  return parts.length ? parts.join("; ") + "." : "Setup data unavailable.";
}

/**
 * Structured messages for every AI call.
 * `system` is 100% static → OpenRouter caches it (X-OpenRouter-Cache: true).
 * `user` is per-symbol dynamic data only.
 */
export type AIMessages = { system: string; user: string };

type PromptEvidence = Partial<AnalysisEvidenceSnapshot> | null | undefined;

function promptPercent(value: number | null | undefined, decimals = 1) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const pct = Math.abs(value) <= 1 ? value * 100 : value;
  return `${pct.toFixed(decimals)}%`;
}

function promptMoney(value: number | null | undefined, decimals = 2) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `$${value.toFixed(decimals)}`;
}

function compactPromptList(items: string[] | null | undefined, max = 4) {
  return (items ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function buildDividendPromptLines(data: DividendData | null | undefined) {
  if (!data) return [];

  const displayYield = data.dividendYield ?? data.trailingAnnualDividendYield;
  const displayRate = data.dividendRate ?? data.trailingAnnualDividendRate;
  const byYear = new Map<number, number>();
  for (const payment of data.history ?? []) {
    const d = new Date(payment.date);
    if (Number.isNaN(d.getTime()) || !Number.isFinite(payment.amount)) continue;
    const year = d.getUTCFullYear();
    byYear.set(year, (byYear.get(year) ?? 0) + payment.amount);
  }
  const annual = Array.from(byYear.entries())
    .sort(([a], [b]) => a - b)
    .slice(-5)
    .map(([year, total]) => `${year}: $${total.toFixed(2)}`);

  if (displayYield == null && displayRate == null && annual.length === 0) return [];

  return [
    "Dividend / shareholder return evidence:",
    `- Current annual dividend rate: ${promptMoney(displayRate)} | yield: ${promptPercent(displayYield, 2)} | ex-div date: ${data.exDividendDate ? new Date(data.exDividendDate).toDateString() : "N/A"}`,
    annual.length ? `- Recent annual dividends per share: ${annual.join("; ")}` : null,
  ].filter((line): line is string => line != null);
}

function buildFundamentalEvidenceBlock(evidence: PromptEvidence) {
  const simple = evidence?.simpleAnalysis ?? null;
  const dividend = evidence?.dividendData ?? null;
  const lines = ["## FUNDAMENTAL EVIDENCE SHOWN TO USER"];

  if (!simple) {
    lines.push("No multi-year fundamental evidence card is available for this run.");
  } else {
    lines.push(
      `Overall posture: ${simple.posture} | business: ${simple.businessView} | valuation: ${simple.valuationView} | balance sheet: ${simple.balanceSheetView} | debt service: ${simple.debtServiceView} | profitability: ${simple.profitabilityView} | shareholder trend: ${simple.shareholderView}`,
    );

    const kpiLines = (simple.kpiTiles ?? []).slice(0, 4).map((tile) => {
      const latest = `${tile.latest.value} (${tile.latest.period})`;
      const qoq = tile.qoq.value ?? "N/A";
      const yoy = tile.yoy.value ?? "N/A";
      const cagr = tile.cagr.value ?? "N/A";
      return `- ${tile.metricLabel}: latest ${latest}; QoQ ${qoq}; YoY ${yoy}; CAGR ${cagr}`;
    });
    if (kpiLines.length) {
      lines.push("KPI tiles:", ...kpiLines);
    }

    if (simple.cagrTable?.rows.length) {
      lines.push(
        "CAGR table:",
        ...simple.cagrTable.rows.slice(0, 4).map((row) => {
          const cells = row.cells
            .map((cell) => `${cell.horizonLabel} ${cell.cagr ?? "N/A"}`)
            .join("; ");
          return `- ${row.metricLabel}: ${cells}`;
        }),
      );
    }

    if (simple.valuationCard) {
      lines.push(
        `Valuation card: P/E TTM ${simple.valuationCard.ttmLabel}x | P/E NTM ${simple.valuationCard.ntmLabel}x | tone ${simple.valuationCard.tone} | ${simple.valuationCard.description}`,
      );
    }

    if (simple.balanceSheet?.length) {
      lines.push(
        "Balance sheet / durability strip:",
        ...simple.balanceSheet.map(
          (entry) =>
            `- ${entry.label}: ${entry.value} (${entry.tone}, ${entry.trend}) — ${entry.description}`,
        ),
      );
    }

    const takeaways = compactPromptList(simple.takeaways, 5);
    if (takeaways.length) {
      lines.push("Evidence takeaways:", ...takeaways.map((item) => `- ${item}`));
    }
  }

  const dividendLines = buildDividendPromptLines(dividend);
  if (dividendLines.length) lines.push(...dividendLines);

  lines.push(
    "Grounding rule: the user will see the evidence above. Do not contradict it. If the macro thesis overrides weak metrics, say exactly why and keep confidence/risk honest.",
  );

  return lines.join("\n");
}

function buildPrompt(
  d: StockData,
  memory: string,
  isDaily: boolean,
  analysisDate: string,
  prior?: PriorAnalysisContext | null,
  evidence?: PromptEvidence,
): AIMessages {
  const fmt = (n: number | null | undefined, dec = 2) => (n != null ? n.toFixed(dec) : "N/A");

  const priorBlock = prior
    ? `\n\n## PRIOR CALL PERFORMANCE\n${buildPriorCallBlock(prior, d.currentPrice)}`
    : "";
  const fundamentalEvidenceBlock = buildFundamentalEvidenceBlock(evidence);

  const user = `## STOCK MEMORY (accumulated context)
${memory}${priorBlock}

## SETUP CONTEXT
${describeSetup(d)}

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

${fundamentalEvidenceBlock}

${
  isDaily
    ? `CONTEXT: Daily update as of ${analysisDate}. Only set signalChanged=true if something material shifted.`
    : `CONTEXT: Shared analysis as of ${analysisDate}.`
}`;
  return { system: ANALYSIS_SYSTEM_PROMPT, user };
}

export function buildStructuredPrompt(
  d: StockData,
  memory: string,
  isDaily: boolean,
  analysisDate: string,
  prior?: PriorAnalysisContext | null,
  evidence?: PromptEvidence,
): AIMessages {
  return {
    ...buildPrompt(d, memory, isDaily, analysisDate, prior, evidence),
    system: STRUCTURED_ANALYSIS_SYSTEM_PROMPT,
  };
}

export async function chargeUserForUsage(
  userId: string,
  reservationId: string,
  symbol: string,
  usage: AIUsage | null,
) {
  const { getD1Database } = await import("../lib/db");
  const { completedAnalysisCharge, getAnalysisMaxChargeCents, settleAnalysisUsage } =
    await import("../lib/analysis-reservation");
  const { getUsdToEurRate } = await import("../lib/fx");

  const billing = usage
    ? calculateBilledCost({
        actualModel: usage.model,
        providerCostUsd: usage.costUsd,
        usdToEurRate: await getUsdToEurRate(),
      })
    : null;
  const settlement = await settleAnalysisUsage(getD1Database(), {
    userId,
    reservationId,
    symbol,
    model: usage?.model ?? "usage-unavailable",
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    providerCostUsd: usage?.costUsd ?? null,
    calculatedCents: completedAnalysisCharge(
      billing?.billedCents ?? null,
      getAnalysisMaxChargeCents(),
    ),
    usageReported: usage !== null,
  });

  return {
    billedCents: settlement.chargedCents,
    calculatedCents: billing?.billedCents ?? null,
    providerCostUsd: billing?.providerCostUsd ?? null,
    usageReported: usage !== null,
  };
}

// ─── Memory helpers ───────────────────────────────────────────────────────────

export async function readMemory(symbol: string): Promise<string> {
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

type ParsedAnalysisSections = {
  signal: z.infer<typeof signalSchema>;
  opportunityJson: z.infer<typeof macroThesisSchema> | null;
  thesisJson: z.infer<typeof stockThesisSchema> | null;
  contextJson: z.infer<typeof contextSchema> | null;
  memoryUpdate: string | null;
};

function parsedSectionsFromAnalysisOutput(
  output: AnalysisOutput,
  symbol: string,
): ParsedAnalysisSections {
  const normalized = normalizeAnalysisOutput(output);
  return normalizeParsedAnalysisSections(
    {
      signal: normalized.signal,
      opportunityJson: normalized.opportunity,
      thesisJson: normalized.thesis,
      contextJson: normalized.context,
      memoryUpdate: normalized.memoryUpdate,
    },
    symbol,
  );
}

function buildMemorySnapshot(symbol: string, parsed: ParsedAnalysisSections, analysisDate: string) {
  const signal = parsed.signal;
  const opportunity = parsed.opportunityJson;
  const thesis = parsed.thesisJson;
  const lines = [
    `# ${symbol.toUpperCase()} — Stock Memory`,
    "",
    `## Latest view (${analysisDate})`,
    `- Weekly action: ${String(signal.weeklyCall)}`,
    `- Cycle bias: ${String(signal.signal)} / ${String(signal.cycle)}`,
    `- Weekly confidence: ${signal.confidence}%`,
    opportunity ? `- Opportunity score: ${opportunity.opportunityScore}%` : null,
    opportunity ? `- Bottleneck role: ${opportunity.bottleneckRole}` : null,
    "",
    "## Thesis",
    thesis ? thesis.summary : opportunity ? opportunity.secularBet : "No durable thesis saved yet.",
    "",
    "## Demand to equity map",
    opportunity && opportunity.demandScenarios.length
      ? opportunity.demandScenarios
          .slice(0, 3)
          .map((scenario) => {
            const label = scenario.case || "case";
            const driver = scenario.demandDriver || "Demand change";
            const earnings =
              scenario.earningsImpactPct != null
                ? `${scenario.earningsImpactPct}% earnings impact`
                : "earnings impact uncertain";
            const equity =
              scenario.equityImpactPct != null
                ? `${scenario.equityImpactPct}% equity impact`
                : "equity impact uncertain";
            return `- ${label}: ${driver} → ${earnings} → ${equity}`;
          })
          .join("\n")
      : "- No scenario map saved yet.",
    "",
    "## Watch items",
    signal.keyBearishFactors.length
      ? signal.keyBearishFactors
          .slice(0, 4)
          .map((item) => `- ${item}`)
          .join("\n")
      : "- No specific watch items saved.",
    parsed.memoryUpdate ? `\n## Model notes\n${parsed.memoryUpdate}` : null,
  ].filter((line): line is string => line != null);

  return lines.join("\n").trim();
}

async function buildPersistedThesisJson(
  symbol: string,
  parsedSignal: ParsedAnalysisSections["signal"],
  stockData: StockData,
  options?: {
    hasExtremeRisk?: boolean;
    macroThesis?: ParsedAnalysisSections["opportunityJson"];
    aiThesisJson?: ParsedAnalysisSections["thesisJson"];
    aiContextJson?: ParsedAnalysisSections["contextJson"];
    analysisEvidence?: AnalysisEvidenceSnapshot | null;
  },
) {
  const [{ buildStockThesis, parseAIStockThesis, STOCK_THESIS_VERSION }, stocksModule] =
    await Promise.all([import("../lib/stock-thesis"), import("./stocks")]);

  const simpleAnalysis = options?.analysisEvidence
    ? options.analysisEvidence.simpleAnalysis
    : await stocksModule.getSimpleAnalysisForSymbol(symbol).catch(() => null);

  // Merge AI-generated context (title, summary, takeaways) into the evidence object
  // so the evidence card shows company-specific copy rather than hardcoded strings.
  let enrichedSimpleAnalysis = simpleAnalysis;
  if (simpleAnalysis && options?.aiContextJson) {
    const ctx = options.aiContextJson;
    enrichedSimpleAnalysis = {
      ...simpleAnalysis,
      title: ctx.title,
      summary: ctx.summary,
      takeaways: ctx.takeaways,
    };
  }

  let macroThesis = null;
  if (options?.macroThesis) {
    const { parseMacroThesis } = await import("../lib/simple-analysis");
    macroThesis = parseMacroThesis(JSON.stringify(options.macroThesis));
  }

  const weeklyContext = {
    signal: parsedSignal.signal as "BUY" | "SELL",
    weeklyCall: parsedSignal.weeklyCall ?? null,
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
  };

  // Prefer AI-generated thesis, but ground its pillars/confidence against the
  // same metrics snapshot shown in the UI. Fall back to the deterministic
  // rule-engine for older or invalid analyses.
  let thesis = options?.aiThesisJson
    ? parseAIStockThesis(options.aiThesisJson, parsedSignal.confidence ?? null, {
        evidence: enrichedSimpleAnalysis,
        weekly: weeklyContext,
        macroThesis,
        hasExtremeRisk: options?.hasExtremeRisk,
      })
    : null;

  if (!thesis) {
    thesis = buildStockThesis(weeklyContext, enrichedSimpleAnalysis, {
      hasExtremeRisk: options?.hasExtremeRisk,
      macroThesis,
    });
  }

  return {
    simpleAnalysisJson: enrichedSimpleAnalysis ? JSON.stringify(enrichedSimpleAnalysis) : null,
    thesisJson: thesis ? JSON.stringify(thesis) : null,
    thesisVersion: thesis?.version ?? STOCK_THESIS_VERSION,
  };
}

// ─── Shared save logic ───────────────────────────────────────────────────────

export async function saveAnalysisOutput({
  db,
  symbol,
  output,
  stockData,
  analysisEvidence,
  userId,
  analysisDate,
}: {
  db: Awaited<ReturnType<typeof import("../lib/db").getDb>>;
  symbol: string;
  output: AnalysisOutput;
  stockData: Awaited<ReturnType<typeof gatherStockData>>;
  analysisEvidence?: AnalysisEvidenceSnapshot | null;
  userId: string;
  analysisDate: string;
}): Promise<string> {
  const parsed = parsedSectionsFromAnalysisOutput(output, symbol);
  const {
    signal: parsedSignal,
    opportunityJson,
    thesisJson: aiThesisJson,
    contextJson: aiContextJson,
  } = parsed;

  const { simpleAnalysisJson, thesisJson, thesisVersion } = await buildPersistedThesisJson(
    symbol,
    parsedSignal,
    stockData,
    {
      hasExtremeRisk: false,
      macroThesis: opportunityJson ?? null,
      aiThesisJson: aiThesisJson ?? null,
      aiContextJson: aiContextJson ?? null,
      analysisEvidence: analysisEvidence ?? null,
    },
  );

  const recId = randomUUID();
  const now = new Date();

  await db.insert(stockAnalysis).values({
    id: recId,
    symbol,
    analysisDate,
    signal: parsedSignal.signal as Signal,
    cycle: (parsedSignal.cycle as string | null | undefined) ?? null,
    cycleTimeframe: (parsedSignal.cycleTimeframe as string | null | undefined) ?? null,
    cycleStrength: (parsedSignal.cycleStrength as number | null | undefined) ?? null,
    confidence: parsedSignal.confidence as number,
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
  await writeMemory(symbol, buildMemorySnapshot(symbol, parsed, analysisDate));

  return recId;
}
