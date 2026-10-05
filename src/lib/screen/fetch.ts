import {
  getEarningsSurprises,
  getFundamentalsTimeSeries,
  getHistoricalPrices,
  getMarketQuote,
  getMarketSummary,
} from "../market-data";
import type { Statements, SymbolData } from "./compute";

// 16 months of daily bars: 12-1 momentum needs 12*21 + 1*21 sessions, and the
// tail feeds the 3-month ADV average.
const PRICE_MONTHS = 16;
const MOM_SESSIONS = 12 * 21 + 1 * 21;
const ADV_SESSIONS = 63;
const SKIP_SESSIONS = 21;

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

function latestTwo(series: { date: string; value: number | null }[] | undefined) {
  const points = (series ?? [])
    .filter((p) => p.value !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return [points[0]?.value ?? null, points[1]?.value ?? null] as [number | null, number | null];
}

function latest(series: { date: string; value: number | null }[] | undefined) {
  const points = (series ?? [])
    .filter((p) => p.value !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return points[0]?.value ?? null;
}

function trendEntry(summary: Awaited<ReturnType<typeof getMarketSummary>>, period: string) {
  return summary.earningsTrend?.trend?.find((t) => t.period === period) ?? null;
}

function revision(entry: ReturnType<typeof trendEntry>): number | null {
  const cur = entry?.epsTrend?.current ?? null;
  const old = entry?.epsTrend?.["90daysAgo"] ?? null;
  if (cur === null || old === null || old === 0) return null;
  return cur / old - 1;
}

async function fetchStatements(symbol: string): Promise<Statements> {
  const period1 = new Date(Date.now() - 3 * 365 * 24 * 3600 * 1000);
  const series = await getFundamentalsTimeSeries(symbol, { period1, period2: new Date() }, [
    ...STATEMENT_TYPES,
  ]);
  const s = (type: string) => series[type];
  const [ebit, depreciation] = [
    latest(s("annualEBIT")),
    latest(s("annualReconciledDepreciation")) ??
      latest(s("annualDepreciationAmortizationDepletion")),
  ];
  const totalDebt =
    latest(s("annualTotalDebt")) ??
    (() => {
      const ltd = latest(s("annualLongTermDebt"));
      const cd = latest(s("annualCurrentDebt"));
      return ltd === null && cd === null ? null : (ltd ?? 0) + (cd ?? 0);
    })();
  return {
    ebit,
    depreciation,
    pretaxIncome: latest(s("annualPretaxIncome")),
    taxProvision: latest(s("annualTaxProvision")),
    netIncome: latestTwo(s("annualNetIncome")),
    totalRevenue: latestTwo(s("annualTotalRevenue")),
    grossProfit: latestTwo(s("annualGrossProfit")),
    totalAssets: latestTwo(s("annualTotalAssets")),
    currentAssets: latestTwo(s("annualCurrentAssets")),
    currentLiabilities: latestTwo(s("annualCurrentLiabilities")),
    totalDebt,
    longTermDebt: latestTwo(s("annualLongTermDebt")),
    stockholdersEquity: latest(s("annualStockholdersEquity")),
    cash: latest(s("annualCashAndCashEquivalents")),
    shortTermInvestments: latest(s("annualOtherShortTermInvestments")),
    sharesOutstanding:
      latestTwo(s("annualOrdinarySharesNumber")) ?? latestTwo(s("annualShareIssued")),
    operatingCashFlow: latest(s("annualOperatingCashFlow")),
  };
}

export async function fetchScreenData(symbol: string): Promise<SymbolData> {
  const period1 = new Date(Date.now() - PRICE_MONTHS * 31 * 24 * 3600 * 1000);
  const [quote, summary, prices, surprises] = await Promise.all([
    getMarketQuote(symbol),
    getMarketSummary(symbol),
    getHistoricalPrices(symbol, { period1, period2: new Date() }),
    getEarningsSurprises(symbol),
  ]);

  const closes = prices
    .map((p) => p.close)
    .filter((c): c is number => c !== null && c !== undefined);
  const bars = prices.slice(-ADV_SESSIONS);
  const advValues = bars
    .map((p) => (p.close !== null && p.close !== undefined ? p.close * (p.volume ?? 0) : null))
    .filter((v): v is number => v !== null);
  const adv = advValues.length ? advValues.reduce((a, b) => a + b, 0) / advValues.length : null;
  const mom121 =
    closes.length >= MOM_SESSIONS
      ? closes[closes.length - 1 - SKIP_SESSIONS] / closes[closes.length - MOM_SESSIONS] - 1
      : null;

  const fy1 = trendEntry(summary, "0y");
  const fy2 = trendEntry(summary, "+1y");
  const surpriseFractions = surprises
    .filter((s) => s.epsActual !== null && s.epsEstimate !== null && s.epsEstimate !== 0)
    .map((s) => (s.epsActual! - s.epsEstimate!) / Math.abs(s.epsEstimate!));

  return {
    currency: quote.currency ?? null,
    sector: summary.assetProfile?.sector ?? null,
    mcap: summary.price?.marketCap ?? quote.marketCap ?? null,
    adv,
    analysts: summary.financialData?.numberOfAnalystOpinions ?? null,
    fy1Rev: revision(fy1),
    fy2Rev: revision(fy2),
    upLast30d: fy1?.epsRevisions?.upLast30days ?? null,
    downLast30d: fy1?.epsRevisions?.downLast30days ?? null,
    surprises: surpriseFractions,
    statements: await fetchStatements(symbol),
    mom121,
    fwdPe: summary.summaryDetail?.forwardPE ?? quote.forwardPE ?? null,
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
    const json = (await res.json()) as {
      chart?: { result?: { indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const closes = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    const valid = Array.isArray(closes) ? closes.filter((c): c is number => c !== null) : [];
    return valid.length ? valid[valid.length - 1] : null;
  } catch {
    return null;
  }
}
