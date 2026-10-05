import { z } from "zod";
import {
  getEarningsSurprises,
  getFundamentalsTimeSeries,
  getRevisionPrices,
  getRevisionSummary,
} from "../market-data";
import { advFromBars, momentumFromCloses, type ScreenParams, type SymbolData } from "./compute";
import { readRevision, readStatements } from "./data";

// 16 months of daily bars: 12-1 momentum needs 12*21 + 1 closes, and the
// tail feeds the 3-month ADV average.
const PRICE_MONTHS = 16;
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
  "annualCapitalExpenditure",
  "annualOperatingCashFlow",
];

async function fetchStatements(symbol: string) {
  const period1 = new Date(Date.now() - 3 * 365 * 24 * 3600 * 1000);
  const series = await getFundamentalsTimeSeries(symbol, { period1, period2: new Date() }, [
    ...STATEMENT_TYPES,
  ]);
  return readStatements(series);
}

/** Three requests per symbol in the happy path: summary (8 modules incl.
 * estimates + surprises), 16mo chart (prices + currency), statements. */
export async function fetchScreenData(symbol: string, params: ScreenParams) {
  const period1 = new Date(Date.now() - PRICE_MONTHS * 31 * 24 * 3600 * 1000);
  const [summary, prices, fiscal] = await Promise.all([
    getRevisionSummary(symbol),
    getRevisionPrices(symbol, { period1, period2: new Date() }),
    fetchStatements(symbol),
  ]);
  const surprises = await getEarningsSurprises(symbol, summary);

  const currency = summary.price?.currency ?? null;
  const mcap = summary.price?.marketCap ?? null;

  const fy1 = readRevision(summary.earningsTrend?.trend?.find((t) => t.period === "0y"));
  const fy2 = readRevision(summary.earningsTrend?.trend?.find((t) => t.period === "+1y"));
  const surpriseFractions = surprises
    .slice()
    .sort((a, b) => (a.quarter < b.quarter ? 1 : -1)) // newest first
    .filter((s) => s.epsActual !== null && s.epsEstimate !== null && s.epsEstimate !== 0)
    .map((s) => (s.epsActual! - s.epsEstimate!) / Math.abs(s.epsEstimate!));

  const closes = prices.map((p) => p.adjClose ?? null);
  const liquidity = prices.slice(-ADV_SESSIONS);
  const completeLiquidity =
    liquidity.length === ADV_SESSIONS &&
    liquidity.every(
      (p) =>
        Number.isFinite(p.close) &&
        (p.close ?? 0) > 0 &&
        Number.isFinite(p.volume) &&
        (p.volume ?? -1) >= 0,
    );
  const data: SymbolData = {
    currency,
    financialCurrency: summary.financialData?.financialCurrency ?? null,
    sector: summary.assetProfile?.sector ?? null,
    mcap,
    adv: completeLiquidity ? advFromBars(liquidity) : null,
    analysts: summary.financialData?.numberOfAnalystOpinions ?? null,
    fy1Rev: fy1.revision,
    fy2Rev: fy2.revision,
    upLast30d: fy1.up30,
    downLast30d: fy1.down30,
    epsGrowthFy1: fy1.epsGrowth,
    surprises: surpriseFractions,
    statements: fiscal.statements,
    mom121: momentumFromCloses(
      closes,
      params.momentumMonthsBack * 21,
      params.momentumMonthsSkip * 21,
    ),
    fwdPe: summary.summaryDetail?.forwardPE ?? null,
  };
  const issues: string[] = [
    "Estimate update timestamps are not provided; freshness is unverified.",
  ];
  if (fy1.revision === null || fy2.revision === null)
    issues.push("Missing or non-positive FY1/FY2 EPS baseline; revision cannot be compared.");
  if (!fy1.targetDate || !fy2.targetDate) issues.push("Consensus fiscal target dates unavailable.");
  if (prices.length < ADV_SESSIONS) throw new Error("Fewer than 63 trading sessions for liquidity");
  if (
    (fy1.revision !== null && Math.abs(fy1.revision) > 1) ||
    (fy2.revision !== null && Math.abs(fy2.revision) > 1)
  )
    issues.push("EPS revision exceeds 100%; inspect small baselines and one-off effects.");
  const latestPrice = prices.at(-1)?.date;
  if (!latestPrice || Date.now() - latestPrice.getTime() > 7 * 86400000)
    throw new Error("Price history is missing or older than seven days");
  if (!fiscal.date || Date.now() - Date.parse(fiscal.date) > 550 * 86400000)
    throw new Error("Annual statements are missing or older than 18 months");
  return {
    name: summary.price?.longName ?? summary.price?.shortName ?? symbol,
    data,
    issues,
    snapshot: {
      source: "Yahoo Finance",
      fetchedAt: new Date().toISOString(),
      fy1,
      fy2,
      statementDate: fiscal.date,
      priorStatementDate: fiscal.priorDate,
      priceDate: latestPrice.toISOString(),
      data,
    },
  };
}

export async function fetchFxRates(): Promise<Record<string, number>> {
  const eurPairs = ["EURUSD", "EURGBP", "EURCHF", "EURSEK", "EURDKK", "EURNOK", "EURJPY"];
  const usdPairs = ["CNY", "HKD", "TWD", "KRW", "INR", "CAD", "AUD", "BRL", "SAR"];
  type FxRates = Record<string, number>;
  const unitsPerEur: FxRates = { EUR: 1 };

  await Promise.all(
    eurPairs.map(async (pair) => {
      const ccy = pair.replace("EUR", "");
      const v = await fetchYahooRate(pair + "=X");
      if (v !== null && Number.isFinite(v) && v > 0) unitsPerEur[ccy] = v;
    }),
  );
  const eurusd = unitsPerEur["USD"];
  await Promise.all(
    usdPairs.map(async (ccy) => {
      const v = await fetchYahooRate(ccy + "=X");
      if (v !== null && Number.isFinite(v) && v > 0 && eurusd !== undefined)
        unitsPerEur[ccy] = v * eurusd;
    }),
  );
  return unitsPerEur;
}

async function fetchYahooRate(pair: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${pair}?range=5d&interval=1d`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
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
