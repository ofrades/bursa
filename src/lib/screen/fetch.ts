import { z } from "zod";
import {
  getEarningsSurprises,
  getFundamentalsTimeSeries,
  getHistoricalPrices,
  getMarketQuote,
  getMarketSummary,
} from "../market-data";
import { advFromBars, momentumFromCloses, type Statements, type SymbolData } from "./compute";

// 16 months of daily bars: 12-1 momentum needs 12*21 + 1*21 sessions, and the
// tail feeds the 3-month ADV average.
const PRICE_MONTHS = 16;
const MOM_BACK = 12 * 21;
const MOM_SKIP = 1 * 21;
const ADV_SESSIONS = 63;

const STATEMENT_TYPES = [
  "annualEBIT",
  "annualPretaxIncome",
  "annualTaxProvision",
  "annualGrossProfit",
  "annualTotalRevenue",
  "annualNetIncome",
  "annualTotalAssets",
  "annualCurrentAssets",
  "annualCurrentLiabilities",
  "annualLongTermDebt",
  "annualCurrentDebt",
  "annualTotalDebt",
  "annualStockholdersEquity",
  "annualCashAndCashEquivalents",
  "annualOtherShortTermInvestments",
  "annualOrdinarySharesNumber",
  "annualShareIssued",
  "annualReconciledDepreciation",
  "annualDepreciationAmortizationDepletion",
  "annualOperatingCashFlow",
];

type SeriesPoint = { date: string; value: number | null };

function sortedDesc(series: SeriesPoint[] | undefined) {
  return (series ?? []).filter((p) => p.value !== null).sort((a, b) => (a.date < b.date ? 1 : -1));
}

function latest(series: SeriesPoint[] | undefined): number | null {
  return sortedDesc(series)[0]?.value ?? null;
}

function latestTwo(series: SeriesPoint[] | undefined): [number | null, number | null] {
  const rows = sortedDesc(series);
  return [rows[0]?.value ?? null, rows[1]?.value ?? null];
}

type TrendRevision = { revision: number | null; up30: number | null; down30: number | null };

function trendRevision(
  summary: Awaited<ReturnType<typeof getMarketSummary>>,
  period: string,
): TrendRevision {
  const entry = summary.earningsTrend?.trend?.find((t) => t.period === period) ?? null;
  const cur = entry?.epsTrend?.current ?? null;
  const old = entry?.epsTrend?.["90daysAgo"] ?? null;
  const revision = cur !== null && old !== null && old !== 0 ? cur / old - 1 : null;
  return {
    revision,
    up30: entry?.epsRevisions?.upLast30days ?? null,
    down30: entry?.epsRevisions?.downLast30days ?? null,
  };
}

async function fetchStatements(symbol: string): Promise<Statements> {
  const period1 = new Date(Date.now() - 3 * 365 * 24 * 3600 * 1000);
  const series = await getFundamentalsTimeSeries(symbol, { period1, period2: new Date() }, [
    ...STATEMENT_TYPES,
  ]);
  const s = (type: string) => series[type];
  const ltd = latest(s("annualLongTermDebt"));
  const currentDebt = latest(s("annualCurrentDebt"));
  return {
    ebit: latest(s("annualEBIT")),
    depreciation:
      latest(s("annualReconciledDepreciation")) ??
      latest(s("annualDepreciationAmortizationDepletion")),
    pretaxIncome: latest(s("annualPretaxIncome")),
    taxProvision: latest(s("annualTaxProvision")),
    netIncome: latestTwo(s("annualNetIncome")),
    totalRevenue: latestTwo(s("annualTotalRevenue")),
    grossProfit: latestTwo(s("annualGrossProfit")),
    totalAssets: latestTwo(s("annualTotalAssets")),
    currentAssets: latestTwo(s("annualCurrentAssets")),
    currentLiabilities: latestTwo(s("annualCurrentLiabilities")),
    totalDebt:
      latest(s("annualTotalDebt")) ??
      (ltd === null && currentDebt === null ? null : (ltd ?? 0) + (currentDebt ?? 0)),
    longTermDebt: latestTwo(s("annualLongTermDebt")),
    stockholdersEquity: latest(s("annualStockholdersEquity")),
    cash: latest(s("annualCashAndCashEquivalents")),
    shortTermInvestments: latest(s("annualOtherShortTermInvestments")),
    sharesOutstanding:
      latestTwo(s("annualOrdinarySharesNumber")) ?? latestTwo(s("annualShareIssued")),
    operatingCashFlow: latest(s("annualOperatingCashFlow")),
  };
}

/** Three requests per symbol in the happy path: summary (8 modules incl.
 * estimates + surprises), 16mo chart (prices + currency), statements. */
export async function fetchScreenData(symbol: string): Promise<SymbolData> {
  const period1 = new Date(Date.now() - PRICE_MONTHS * 31 * 24 * 3600 * 1000);
  const [summary, prices, statements] = await Promise.all([
    getMarketSummary(symbol),
    getHistoricalPrices(symbol, { period1, period2: new Date() }),
    fetchStatements(symbol),
  ]);
  const surprises = await getEarningsSurprises(symbol, summary);

  let currency = summary.price?.currency ?? null;
  let mcap = summary.price?.marketCap ?? null;
  if (currency === null || mcap === null) {
    const quote = await getMarketQuote(symbol);
    currency = currency ?? quote.currency ?? null;
    mcap = mcap ?? quote.marketCap ?? null;
  }

  const fy1 = trendRevision(summary, "0y");
  const fy2 = trendRevision(summary, "+1y");
  const surpriseFractions = surprises
    .slice()
    .sort((a, b) => (a.quarter < b.quarter ? 1 : -1)) // newest first
    .filter((s) => s.epsActual !== null && s.epsEstimate !== null && s.epsEstimate !== 0)
    .map((s) => (s.epsActual! - s.epsEstimate!) / Math.abs(s.epsEstimate!));

  const closes = prices.map((p) => p.adjClose ?? p.close ?? null);
  return {
    currency,
    sector: summary.assetProfile?.sector ?? null,
    mcap,
    adv: advFromBars(prices.slice(-ADV_SESSIONS)),
    analysts: summary.financialData?.numberOfAnalystOpinions ?? null,
    fy1Rev: fy1.revision,
    fy2Rev: fy2.revision,
    upLast30d: fy1.up30,
    downLast30d: fy1.down30,
    surprises: surpriseFractions,
    statements,
    mom121: momentumFromCloses(closes, MOM_BACK, MOM_SKIP),
    fwdPe: summary.summaryDetail?.forwardPE ?? null,
  };
}

export async function fetchFxRates(): Promise<Record<string, number>> {
  const eurPairs = ["EURUSD", "EURGBP", "EURCHF", "EURSEK", "EURDKK", "EURNOK", "EURJPY"];
  const usdPairs = ["CNY", "HKD", "TWD", "KRW", "INR", "CAD", "AUD", "BRL", "SAR"];
  const unitsPerEur: Record<string, number> = {};

  await Promise.all(
    eurPairs.map(async (pair) => {
      const ccy = pair.replace("EUR", "");
      const v = await fetchYahooRate(pair + "=X");
      if (v !== null) unitsPerEur[ccy] = v;
    }),
  );
  const eurusd = unitsPerEur["USD"];
  await Promise.all(
    usdPairs.map(async (ccy) => {
      const v = await fetchYahooRate(ccy + "=X");
      if (v !== null && eurusd !== undefined) unitsPerEur[ccy] = v * eurusd;
    }),
  );
  return unitsPerEur;
}

async function fetchYahooRate(pair: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${pair}?range=5d&interval=1d`,
    );
    if (!res.ok) return null;
    const payload = z
      .object({
        chart: z.object({
          result: z.array(z.object({ meta: z.object({ regularMarketPrice: z.number() }) })),
        }),
      })
      .safeParse(await res.json());
    return payload.success ? payload.data.chart.result[0].meta.regularMarketPrice : null;
  } catch {
    return null;
  }
}
