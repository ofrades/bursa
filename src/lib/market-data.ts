import { z } from "zod";
import { getSecret } from "../secrets";

type SearchResult = {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  quoteType?: string;
};

type HistoricalPoint = {
  date: Date;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
};

type QuoteData = {
  regularMarketPrice?: number | null;
  regularMarketChangePercent?: number | null;
  regularMarketPreviousClose?: number | null;
  marketCap?: number | null;
  trailingPE?: number | null;
  forwardPE?: number | null;
  fiftyTwoWeekHigh?: number | null;
  fiftyTwoWeekLow?: number | null;
  beta?: number | null;
  sharesOutstanding?: number | null;
  longName?: string | null;
  shortName?: string | null;
  exchange?: string | null;
};

type SummaryData = {
  assetProfile?: {
    sector?: string | null;
    industry?: string | null;
    longBusinessSummary?: string | null;
  } | null;
  financialData?: {
    totalDebt?: number | null;
    totalCash?: number | null;
    freeCashflow?: number | null;
    profitMargins?: number | null;
    revenueGrowth?: number | null;
    operatingMargins?: number | null;
    grossMargins?: number | null;
    returnOnEquity?: number | null;
    returnOnAssets?: number | null;
    earningsGrowth?: number | null;
    ebitda?: number | null;
    ebitdaMargins?: number | null;
    operatingCashflow?: number | null;
    currentRatio?: number | null;
    quickRatio?: number | null;
    debtToEquity?: number | null;
  } | null;
  defaultKeyStatistics?: {
    returnOnEquity?: number | null;
    returnOnAssets?: number | null;
    earningsQuarterlyGrowth?: number | null;
    sharesOutstanding?: number | null;
    trailingPE?: number | null;
    forwardPE?: number | null;
    trailingEps?: number | null;
    forwardEps?: number | null;
  } | null;
  summaryDetail?: {
    trailingPE?: number | null;
    forwardPE?: number | null;
  } | null;
  price?: {
    regularMarketPrice?: number | null;
    marketCap?: number | null;
  } | null;
  calendarEvents?: {
    earnings?: {
      earningsDate?: Array<string | Date>;
    } | null;
  } | null;
  earningsTrend?: {
    trend?: Array<{
      epsTrend?: {
        current?: number | null;
        [key: string]: number | null | undefined;
      } | null;
      epsRevisions?: {
        upLast30days?: number | null;
        downLast30days?: number | null;
      } | null;
    }>;
  } | null;
};

type FinancialStatementRow = {
  date: string | Date;
  totalRevenue?: number | null;
  netIncome?: number | null;
  dilutedAverageShares?: number | null;
  weightedAverageShsOutDil?: number | null;
  shareIssued?: number | null;
  ordinarySharesNumber?: number | null;
};

type CashFlowStatementRow = {
  date: string | Date;
  freeCashFlow?: number | null;
  operatingCashFlow?: number | null;
};

type HistoricalOptions = {
  period1: Date;
  period2: Date;
  interval?: "1d" | "1mo";
};

type AnnualStatementOptions = {
  period1: Date;
  period2: Date;
};

type Provider = "yahoo" | "fmp";
function asNumber(value: number | string | null | undefined): number | null {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStringOrNull(value: string | null | undefined): string | null {
  return value ?? null;
}

async function providerFromEnv(): Promise<Provider> {
  const configured = process.env.MARKET_DATA_PROVIDER?.trim().toLowerCase();
  const apiKey = await getSecret("FMP_API_KEY");
  if (configured === "yahoo") return "yahoo";
  if (configured === "fmp" && apiKey) return "fmp";
  return apiKey ? "fmp" : "yahoo";
}

function normalizeQuoteType(type: string | null | undefined) {
  const value = String(type ?? "").toUpperCase();
  if (value.includes("ETF")) return "ETF";
  if (value.includes("STOCK") || value.includes("EQUITY")) return "EQUITY";
  return value || undefined;
}

type RawHistoricalPayload = { historical?: unknown[] } | unknown[] | null;

function normalizeHistoricalRows(payload: RawHistoricalPayload): HistoricalPoint[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.historical)
      ? payload.historical
      : [];

  return rows
    .map((row: any) => ({
      date: new Date(row.date),
      open: asNumber(row.open),
      high: asNumber(row.high),
      low: asNumber(row.low),
      close: asNumber(row.close),
      volume: asNumber(row.volume),
    }))
    .filter((row: HistoricalPoint) => !Number.isNaN(row.date.getTime()))
    .sort((a: HistoricalPoint, b: HistoricalPoint) => a.date.getTime() - b.date.getTime());
}

async function fmpGet(path: string, params: Record<string, string | number | undefined>) {
  const apiKey = await getSecret("FMP_API_KEY");
  if (!apiKey) throw new Error("Missing FMP_API_KEY");

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, String(value));
  }
  search.set("apikey", apiKey);

  const baseUrl = process.env.FMP_API_BASE ?? "https://financialmodelingprep.com/stable";
  const url = `${baseUrl.replace(/\/$/, "")}/${path}?${search.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    // workerd caps concurrent open request bodies; an abandoned error
    // response deadlocks sibling fetches until it gets canceled.
    try {
      await response.body?.cancel();
    } catch {
      // already closed
    }
    throw new Error(`FMP request failed: ${response.status}`);
  }
  // FMP returns 200 + {"Error Message": "..."} on rate-limit / plan-gated endpoints.
  // Surface those as real errors so the caller's try/catch can fall back to Yahoo.
  const data = await response.json();
  const errorPayload = z.object({ "Error Message": z.string() }).safeParse(data);
  if (errorPayload.success) {
    throw new Error(`FMP error on ${path}: ${errorPayload.data["Error Message"]}`);
  }
  return data;
}

// Yahoo's public REST endpoints hit via plain fetch — workerd-compatible,
// no SDK. Quote-summary needs Yahoo's cookie+crumb dance; the rest are open.
const YAHOO_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

async function yahooGetJson(url: string, cookie?: string): Promise<any> {
  const headers = new Headers({
    "user-agent": YAHOO_UA,
    accept: "application/json",
  });
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { headers });
  if (!response.ok) {
    // See fmpGet: unread error bodies stall workerd's fetch concurrency pool.
    try {
      await response.body?.cancel();
    } catch {
      // already closed
    }
    throw new Error(`Yahoo request failed: ${response.status} ${url}`);
  }
  return response.json();
}

let _yahooCrumb: { crumb: string; cookie: string } | null = null;

async function yahooCrumb(): Promise<{ crumb: string; cookie: string }> {
  if (_yahooCrumb) return _yahooCrumb;

  // Bootstrap cookies from the finance portal rather than fc.yahoo.com:
  // from the EU, fc.yahoo.com often lands on a consent page and never issues
  // the A1/A3 cookies getcrumb requires (it answers 406 without them).
  const bootstrap = await fetch("https://finance.yahoo.com/", {
    headers: {
      "user-agent": YAHOO_UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  const cookie = bootstrap.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  const attempts = [
    `https://query1.finance.yahoo.com/v1/test/getcrumb`,
    `https://query2.finance.yahoo.com/v1/test/getcrumb`,
  ];
  for (const url of attempts) {
    try {
      const parsedCrumb = z
        .string()
        .min(1)
        .safeParse(await yahooGetJson(url, cookie || undefined));
      if (parsedCrumb.success) {
        _yahooCrumb = { crumb: parsedCrumb.data, cookie };
        return _yahooCrumb;
      }
    } catch {
      // try next host
    }
  }
  throw new Error("Yahoo crumb unavailable");
}

type RawYahooQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  quoteType?: string;
};

async function yahooSearchStocks(query: string): Promise<SearchResult[]> {
  const search = new URLSearchParams({ q: query, quotesCount: "8", newsCount: "0" });
  const res = await yahooGetJson(
    `https://query1.finance.yahoo.com/v1/finance/search?${search.toString()}`,
  );

  const quotes: unknown[] = Array.isArray(res?.quotes) ? res.quotes : [];
  return quotes
    .map((quote) => {
      const q = quote as RawYahooQuote;
      return {
        symbol: q.symbol?.toUpperCase() ?? "",
        shortname: q.shortname,
        longname: q.longname,
        exchDisp: q.exchDisp,
        quoteType: normalizeQuoteType(q.quoteType),
      };
    })
    .filter((q) => q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "ETF"));
}

type RawFmpSearchRow = {
  symbol?: string;
  name?: string;
  exchangeShortName?: string;
  exchange?: string;
  type?: string;
};

async function fmpSearchStocks(query: string): Promise<SearchResult[]> {
  const rows = (await fmpGet("search-symbol", { query })) as RawFmpSearchRow[];
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      symbol: String(row.symbol ?? "").toUpperCase(),
      shortname: row.name,
      longname: row.name,
      exchDisp: row.exchangeShortName || row.exchange || undefined,
      quoteType: normalizeQuoteType(row.type),
    }))
    .filter((row) => row.symbol && (row.quoteType === "EQUITY" || row.quoteType === "ETF"));
}

export async function searchStocks(query: string): Promise<SearchResult[]> {
  if ((await providerFromEnv()) === "fmp") {
    try {
      return await fmpSearchStocks(query);
    } catch {
      return yahooSearchStocks(query);
    }
  }
  return yahooSearchStocks(query);
}

async function yahooGetQuote(symbol: string): Promise<QuoteData> {
  // Chart meta carries price/52w/name data; valuation fields (PE, marketCap,
  // beta, shares) are not exposed here and stay null — FMP covers those when
  // configured, and Yahoo is only the fallback provider.
  const res = await yahooGetJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
  );
  const meta = res?.chart?.result?.[0]?.meta ?? {};

  const price = asNumber(meta.regularMarketPrice);
  const previousClose = asNumber(meta.previousClose) ?? asNumber(meta.chartPreviousClose);
  const changePercent =
    price != null && previousClose != null && previousClose !== 0
      ? ((price - previousClose) / previousClose) * 100
      : null;

  return {
    regularMarketPrice: price,
    regularMarketChangePercent: changePercent,
    regularMarketPreviousClose: previousClose,
    marketCap: asNumber(meta.marketCap),
    trailingPE: null,
    forwardPE: null,
    fiftyTwoWeekHigh: asNumber(meta.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: asNumber(meta.fiftyTwoWeekLow),
    beta: null,
    sharesOutstanding: null,
    longName: asStringOrNull(meta.longName),
    shortName: asStringOrNull(meta.shortName),
    exchange: asStringOrNull(meta.fullExchangeName) ?? asStringOrNull(meta.exchangeName),
  };
}

async function fmpGetQuote(symbol: string): Promise<QuoteData> {
  const rows = (await fmpGet("quote", { symbol })) as any[];
  const quote = Array.isArray(rows) ? rows[0] : null;
  return {
    regularMarketPrice: asNumber(quote?.price),
    regularMarketChangePercent: asNumber(quote?.changesPercentage),
    regularMarketPreviousClose: asNumber(quote?.previousClose),
    marketCap: asNumber(quote?.marketCap),
    trailingPE: asNumber(quote?.pe),
    forwardPE: asNumber(quote?.forwardPE),
    fiftyTwoWeekHigh: asNumber(quote?.yearHigh),
    fiftyTwoWeekLow: asNumber(quote?.yearLow),
    beta: asNumber(quote?.beta),
    sharesOutstanding: asNumber(quote?.sharesOutstanding),
    longName: asStringOrNull(quote?.name),
    shortName: asStringOrNull(quote?.name),
    exchange: asStringOrNull(quote?.exchange),
  };
}

export async function getMarketQuote(symbol: string): Promise<QuoteData> {
  if ((await providerFromEnv()) === "fmp") {
    try {
      return await fmpGetQuote(symbol);
    } catch {
      return yahooGetQuote(symbol);
    }
  }
  return yahooGetQuote(symbol);
}

async function yahooGetSummary(symbol: string): Promise<SummaryData> {
  try {
    const { crumb, cookie } = await yahooCrumb();
    const modules = [
      "financialData",
      "defaultKeyStatistics",
      "calendarEvents",
      "assetProfile",
      "earningsTrend",
      "summaryDetail",
      "price",
    ].join(",");
    const summary = await yahooGetJson(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`,
      cookie || undefined,
    );
    const result = summary?.quoteSummary?.result?.[0] ?? null;
    return {
      assetProfile: result?.assetProfile ?? null,
      financialData: result?.financialData ?? null,
      defaultKeyStatistics: result?.defaultKeyStatistics ?? null,
      summaryDetail: result?.summaryDetail ?? null,
      price: result?.price ?? null,
      calendarEvents: result?.calendarEvents ?? null,
      earningsTrend: result?.earningsTrend ?? null,
    };
  } catch (error) {
    // Yahoo's quoteSummary is the last-rung fallback (and EU-hostile);
    // degrade to empty sections rather than failing the whole analysis.
    console.warn(
      `[market-data] yahooGetSummary degraded for ${symbol}:`,
      error instanceof Error ? error.message : error,
    );
    return {
      assetProfile: null,
      financialData: null,
      defaultKeyStatistics: null,
      summaryDetail: null,
      price: null,
      calendarEvents: null,
      earningsTrend: null,
    };
  }
}

async function fmpGetSummary(symbol: string): Promise<SummaryData> {
  // Partial-success assembly: several of these endpoints are gated by FMP
  // plan level, and one premium-gated 402/"Error Message" response used to
  // discard every other field and push the whole summary to the Yahoo
  // fallback. Take what succeeded instead.
  const settled = await Promise.allSettled([
    fmpGet("profile", { symbol }),
    fmpGet("ratios-ttm", { symbol }),
    fmpGet("income-statement-growth", { symbol }),
    fmpGet("analyst-estimates", { symbol, period: "annual", page: 0, limit: 4 }),
    fmpGet("earnings-calendar", { symbol }),
  ]);
  const value = <T>(i: number): T | null =>
    settled[i].status === "fulfilled"
      ? ((settled[i] as PromiseFulfilledResult<T>).value as T)
      : null;

  const profileRows = value<any[]>(0);
  const ratiosRows = value<any[]>(1);
  const growthRows = value<any[]>(2);
  const estimateRows = value<any[]>(3);
  const earningsRows = value<any[]>(4);

  if (!profileRows && !ratiosRows && !growthRows && !estimateRows && !earningsRows) {
    throw new Error(`FMP summary unavailable for ${symbol}: all endpoints failed`);
  }

  const profile = Array.isArray(profileRows) ? profileRows[0] : null;
  const ratios = Array.isArray(ratiosRows) ? ratiosRows[0] : null;
  const growth = Array.isArray(growthRows) ? growthRows[0] : null;
  const estimates = Array.isArray(estimateRows) ? estimateRows : [];
  const earningsCalendar = Array.isArray(earningsRows) ? earningsRows : [];
  const upcomingEarnings = earningsCalendar
    .map(
      (row: any) =>
        new Date(row.date ?? row.fiscalDateEnding ?? row.earningsDate ?? row.reportDate),
    )
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  const futureEarnings = upcomingEarnings.find((date) => date.getTime() >= Date.now()) ?? null;

  const currentEstimate = estimates[0] ?? null;
  const prevEstimate = estimates[1] ?? null;
  const olderEstimate = estimates[2] ?? null;
  const estimateCurrent = asNumber(
    currentEstimate?.estimatedEpsAvg ??
      currentEstimate?.estimatedRevenueAvg ??
      currentEstimate?.epsAvg,
  );
  const estimatePrev = asNumber(
    prevEstimate?.estimatedEpsAvg ?? prevEstimate?.estimatedRevenueAvg ?? prevEstimate?.epsAvg,
  );
  const estimateOlder = asNumber(
    olderEstimate?.estimatedEpsAvg ?? olderEstimate?.estimatedRevenueAvg ?? olderEstimate?.epsAvg,
  );

  return {
    assetProfile: {
      sector: asStringOrNull(profile?.sector),
      industry: asStringOrNull(profile?.industry),
      longBusinessSummary: asStringOrNull(profile?.description),
    },
    financialData: {
      totalDebt:
        asNumber(profile?.debtToEquity) != null && asNumber(profile?.mktCap) != null ? null : null,
      totalCash: null,
      freeCashflow: null,
      profitMargins: asNumber(ratios?.netProfitMarginTTM ?? ratios?.netProfitMargin),
      revenueGrowth: asNumber(growth?.growthRevenue ?? growth?.revenueGrowth),
      operatingMargins: asNumber(ratios?.operatingProfitMarginTTM ?? ratios?.operatingProfitMargin),
      grossMargins: asNumber(ratios?.grossProfitMarginTTM ?? ratios?.grossProfitMargin),
      returnOnEquity: asNumber(ratios?.returnOnEquityTTM ?? ratios?.returnOnEquity),
      returnOnAssets: asNumber(ratios?.returnOnAssetsTTM ?? ratios?.returnOnAssets),
      earningsGrowth: asNumber(growth?.growthNetIncome ?? growth?.netIncomeGrowth),
      ebitda: null,
      ebitdaMargins: asNumber(ratios?.ebitdaMarginTTM ?? ratios?.ebitdaMargin),
      operatingCashflow: null,
      currentRatio: asNumber(ratios?.currentRatioTTM ?? ratios?.currentRatio),
      quickRatio: asNumber(ratios?.quickRatioTTM ?? ratios?.quickRatio),
      debtToEquity: asNumber(ratios?.debtEquityRatioTTM ?? ratios?.debtToEquity),
    },
    defaultKeyStatistics: {
      returnOnEquity: asNumber(ratios?.returnOnEquityTTM ?? ratios?.returnOnEquity),
      returnOnAssets: asNumber(ratios?.returnOnAssetsTTM ?? ratios?.returnOnAssets),
      earningsQuarterlyGrowth: asNumber(growth?.growthEPS ?? growth?.epsgrowth),
      sharesOutstanding: asNumber(profile?.sharesOutstanding),
    },
    calendarEvents: {
      earnings: {
        earningsDate: futureEarnings ? [futureEarnings.toISOString()] : [],
      },
    },
    earningsTrend: {
      trend: [
        {
          epsTrend: {
            current: estimateCurrent,
            "30daysAgo": estimatePrev,
            "90daysAgo": estimateOlder,
          },
          epsRevisions: {
            upLast30days: null,
            downLast30days: null,
          },
        },
      ],
    },
  };
}

export async function getMarketSummary(symbol: string): Promise<SummaryData> {
  if ((await providerFromEnv()) === "fmp") {
    try {
      return await fmpGetSummary(symbol);
    } catch {
      return yahooGetSummary(symbol);
    }
  }
  return yahooGetSummary(symbol);
}

async function yahooGetHistoricalPrices(
  symbol: string,
  options: HistoricalOptions,
): Promise<HistoricalPoint[]> {
  const interval = options.interval ?? "1d";
  const search = new URLSearchParams({
    period1: String(Math.floor(options.period1.getTime() / 1000)),
    period2: String(Math.floor(options.period2.getTime() / 1000)),
    interval,
  });
  const res = await yahooGetJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${search.toString()}`,
  );
  const result = res?.chart?.result?.[0];
  const timestamps: unknown[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] ?? {};

  const rows = timestamps.map((ts, i) => ({
    date: new Date(Number(ts) * 1000),
    open: asNumber((quote as any).open?.[i]),
    high: asNumber((quote as any).high?.[i]),
    low: asNumber((quote as any).low?.[i]),
    close: asNumber((quote as any).close?.[i]),
    volume: asNumber((quote as any).volume?.[i]),
  }));
  return normalizeHistoricalRows(rows);
}

async function fmpGetHistoricalPrices(
  symbol: string,
  options: HistoricalOptions,
): Promise<HistoricalPoint[]> {
  const rows = (await fmpGet("historical-price-eod/full", {
    symbol,
    from: options.period1.toISOString().slice(0, 10),
    to: options.period2.toISOString().slice(0, 10),
  })) as RawHistoricalPayload;
  return normalizeHistoricalRows(rows);
}

export async function getHistoricalPrices(
  symbol: string,
  options: HistoricalOptions,
): Promise<HistoricalPoint[]> {
  if ((await providerFromEnv()) === "fmp") {
    try {
      return await fmpGetHistoricalPrices(symbol, options);
    } catch {
      return yahooGetHistoricalPrices(symbol, options);
    }
  }
  return yahooGetHistoricalPrices(symbol, options);
}

type YahooTimeSeriesRow = {
  asOfDate?: string;
  reportedValue?: { raw?: number | null };
};

async function yahooFundamentalsTimeSeries(
  symbol: string,
  options: AnnualStatementOptions,
  types: string[],
): Promise<Record<string, YahooTimeSeriesRow[]>> {
  const search = new URLSearchParams({
    type: types.join(","),
    period1: String(Math.floor(options.period1.getTime() / 1000)),
    period2: String(Math.floor(options.period2.getTime() / 1000)),
    merge: "false",
  });
  const res = await yahooGetJson(
    `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?${search.toString()}`,
  );
  const result = res?.timeseries?.result?.[0] ?? {};
  const byType: Record<string, YahooTimeSeriesRow[]> = {};
  for (const type of types) {
    const rows = result[type];
    byType[type] = Array.isArray(rows) ? (rows as YahooTimeSeriesRow[]) : [];
  }
  return byType;
}

function mapYahooFinancialStatements(
  byType: Record<string, YahooTimeSeriesRow[]>,
  period: "annual" | "quarterly",
): FinancialStatementRow[] {
  const revenue = byType[`${period}TotalRevenue`] ?? [];
  return revenue.map((row) => {
    const date = row.asOfDate ?? "";
    const pick = (type: string) =>
      asNumber(byType[type]?.find((r) => r.asOfDate === date)?.reportedValue?.raw);
    return {
      date,
      totalRevenue: asNumber(row.reportedValue?.raw),
      netIncome: pick(`${period}NetIncome`) ?? pick(`${period}NetIncomeCommonStockholders`),
      dilutedAverageShares: pick(`${period}DilutedAverageShares`),
      weightedAverageShsOutDil: pick(`${period}DilutedAverageShares`),
      shareIssued: null,
      ordinarySharesNumber: pick(`${period}BasicAverageShares`),
    };
  });
}

async function yahooGetAnnualFinancialStatements(
  symbol: string,
  options: AnnualStatementOptions,
): Promise<FinancialStatementRow[]> {
  const byType = await yahooFundamentalsTimeSeries(symbol, options, [
    "annualTotalRevenue",
    "annualNetIncome",
    "annualNetIncomeCommonStockholders",
    "annualDilutedAverageShares",
    "annualBasicAverageShares",
  ]);
  return mapYahooFinancialStatements(byType, "annual");
}

async function fmpGetAnnualFinancialStatements(symbol: string): Promise<FinancialStatementRow[]> {
  const rows = (await fmpGet("income-statement", { symbol, period: "annual", limit: 10 })) as any[];
  return Array.isArray(rows)
    ? rows.map((row) => ({
        date: row.date,
        totalRevenue: asNumber(row.revenue ?? row.totalRevenue),
        netIncome: asNumber(row.netIncome),
        dilutedAverageShares: asNumber(row.weightedAverageShsOutDil ?? row.dilutedAverageShares),
        weightedAverageShsOutDil: asNumber(row.weightedAverageShsOutDil),
        shareIssued: asNumber(row.commonStockIssued ?? row.shareIssued),
        ordinarySharesNumber: asNumber(row.ordinarySharesNumber),
      }))
    : [];
}

export async function getAnnualFinancialStatements(
  symbol: string,
  options: AnnualStatementOptions,
): Promise<FinancialStatementRow[]> {
  if ((await providerFromEnv()) === "fmp") {
    try {
      return await fmpGetAnnualFinancialStatements(symbol);
    } catch {
      return yahooGetAnnualFinancialStatements(symbol, options);
    }
  }
  return yahooGetAnnualFinancialStatements(symbol, options);
}

async function yahooGetAnnualCashFlowStatements(
  symbol: string,
  options: AnnualStatementOptions,
): Promise<CashFlowStatementRow[]> {
  const byType = await yahooFundamentalsTimeSeries(symbol, options, [
    "annualFreeCashFlow",
    "annualOperatingCashFlow",
  ]);
  const freeCashFlow = byType["annualFreeCashFlow"] ?? [];
  return freeCashFlow.map((row) => ({
    date: row.asOfDate ?? "",
    freeCashFlow: asNumber(row.reportedValue?.raw),
    operatingCashFlow:
      asNumber(
        byType["annualOperatingCashFlow"]?.find((r) => r.asOfDate === row.asOfDate)?.reportedValue
          ?.raw,
      ) ?? null,
  }));
}

async function fmpGetAnnualCashFlowStatements(symbol: string): Promise<CashFlowStatementRow[]> {
  const rows = (await fmpGet("cash-flow-statement", {
    symbol,
    period: "annual",
    limit: 10,
  })) as any[];
  return Array.isArray(rows)
    ? rows.map((row) => ({
        date: row.date,
        freeCashFlow: asNumber(row.freeCashFlow),
        operatingCashFlow: asNumber(
          row.operatingCashFlow ?? row.netCashProvidedByOperatingActivities,
        ),
      }))
    : [];
}

export async function getAnnualCashFlowStatements(
  symbol: string,
  options: AnnualStatementOptions,
): Promise<CashFlowStatementRow[]> {
  if ((await providerFromEnv()) === "fmp") {
    try {
      return await fmpGetAnnualCashFlowStatements(symbol);
    } catch {
      return yahooGetAnnualCashFlowStatements(symbol, options);
    }
  }
  return yahooGetAnnualCashFlowStatements(symbol, options);
}

// ─── Quarterly statements ─────────────────────────────────────────────────────
// Same shape as annual, but `type: "quarterly"`. Used for the new KPI tiles
// and growth chart at the top of the stock page. Yahoo's `fundamentalsTimeSeries`
// returns ~5 quarters for `financials` (with totalRevenue, netIncome, etc.) and a
// sparser response for `cash-flow`, so for FCF we prefer FMP's quarterly endpoint
// and accept nulls where neither source has data.

export async function getQuarterlyFinancialStatements(
  symbol: string,
  options: AnnualStatementOptions,
): Promise<FinancialStatementRow[]> {
  if ((await providerFromEnv()) === "fmp") {
    try {
      return await fmpGetQuarterlyFinancialStatements(symbol);
    } catch {
      return yahooGetQuarterlyFinancialStatements(symbol, options);
    }
  }
  return yahooGetQuarterlyFinancialStatements(symbol, options);
}

export async function getQuarterlyCashFlowStatements(
  symbol: string,
  options: AnnualStatementOptions,
): Promise<CashFlowStatementRow[]> {
  if ((await providerFromEnv()) === "fmp") {
    try {
      return await fmpGetQuarterlyCashFlowStatements(symbol);
    } catch {
      return yahooGetQuarterlyCashFlowStatements(symbol, options);
    }
  }
  return yahooGetQuarterlyCashFlowStatements(symbol, options);
}

async function yahooGetQuarterlyFinancialStatements(
  symbol: string,
  options: AnnualStatementOptions,
): Promise<FinancialStatementRow[]> {
  const byType = await yahooFundamentalsTimeSeries(symbol, options, [
    "quarterlyTotalRevenue",
    "quarterlyNetIncome",
    "quarterlyNetIncomeCommonStockholders",
    "quarterlyDilutedAverageShares",
    "quarterlyBasicAverageShares",
  ]);
  return mapYahooFinancialStatements(byType, "quarterly");
}

async function fmpGetQuarterlyFinancialStatements(
  symbol: string,
): Promise<FinancialStatementRow[]> {
  const rows = (await fmpGet("income-statement", {
    symbol,
    period: "quarter",
    limit: 16,
  })) as any[];
  return Array.isArray(rows)
    ? rows.map((row) => ({
        date: row.date,
        totalRevenue: asNumber(row.revenue ?? row.totalRevenue),
        netIncome: asNumber(row.netIncome),
        dilutedAverageShares: asNumber(row.weightedAverageShsOutDil ?? row.dilutedAverageShares),
        weightedAverageShsOutDil: asNumber(row.weightedAverageShsOutDil),
        shareIssued: asNumber(row.commonStockIssued ?? row.shareIssued),
        ordinarySharesNumber: asNumber(row.ordinarySharesNumber),
      }))
    : [];
}

async function yahooGetQuarterlyCashFlowStatements(
  symbol: string,
  options: AnnualStatementOptions,
): Promise<CashFlowStatementRow[]> {
  // Yahoo's quarterly cash-flow fundamentals series is sparse (often only debt
  // items, no FCF). We still try, but the caller treats an empty result as
  // "no FCF quarterly data" rather than an error.
  const byType = await yahooFundamentalsTimeSeries(symbol, options, [
    "quarterlyFreeCashFlow",
    "quarterlyOperatingCashFlow",
  ]);
  const freeCashFlow = byType["quarterlyFreeCashFlow"] ?? [];
  return freeCashFlow.map((row) => ({
    date: row.asOfDate ?? "",
    freeCashFlow: asNumber(row.reportedValue?.raw),
    operatingCashFlow:
      asNumber(
        byType["quarterlyOperatingCashFlow"]?.find((r) => r.asOfDate === row.asOfDate)
          ?.reportedValue?.raw,
      ) ?? null,
  }));
}

async function fmpGetQuarterlyCashFlowStatements(symbol: string): Promise<CashFlowStatementRow[]> {
  const rows = (await fmpGet("cash-flow-statement", {
    symbol,
    period: "quarter",
    limit: 16,
  })) as any[];
  return Array.isArray(rows)
    ? rows.map((row) => ({
        date: row.date,
        freeCashFlow: asNumber(row.freeCashFlow),
        operatingCashFlow: asNumber(
          row.operatingCashFlow ?? row.netCashProvidedByOperatingActivities,
        ),
      }))
    : [];
}

type DividendPayment = {
  date: Date;
  amount: number;
};

export type DividendData = {
  dividendRate: number | null;
  dividendYield: number | null;
  trailingAnnualDividendRate: number | null;
  trailingAnnualDividendYield: number | null;
  exDividendDate: Date | null;
  history: DividendPayment[];
};

export async function getDividendData(symbol: string): Promise<DividendData> {
  const period1 = new Date();
  period1.setUTCFullYear(period1.getUTCFullYear() - 10);
  period1.setUTCMonth(0, 1);
  period1.setUTCHours(0, 0, 0, 0);

  const chartSearch = new URLSearchParams({
    period1: String(Math.floor(period1.getTime() / 1000)),
    period2: String(Math.floor(Date.now() / 1000)),
    interval: "1mo",
    events: "div",
  });
  const [chartData, summaryData] = await Promise.allSettled([
    yahooGetJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${chartSearch.toString()}`,
    ),
    (async () => {
      const { crumb, cookie } = await yahooCrumb();
      return yahooGetJson(
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail&crumb=${encodeURIComponent(crumb)}`,
        cookie || undefined,
      );
    })(),
  ]);

  const chart = chartData.status === "fulfilled" ? chartData.value?.chart?.result?.[0] : null;
  const summary =
    summaryData.status === "fulfilled"
      ? (summaryData.value?.quoteSummary?.result?.[0]?.summaryDetail ?? null)
      : null;

  // The raw API returns dividends as a map keyed by event id; yf used to
  // normalize it to an array, so accept both shapes.
  const rawEvents: unknown = chart?.events?.dividends ?? [];
  const rawDividends: Array<{ date: any; amount?: number }> = Array.isArray(rawEvents)
    ? rawEvents
    : Object.values(rawEvents as Record<string, { date: any; amount?: number }>);

  const history: DividendPayment[] = rawDividends
    .filter((d) => d.amount != null && d.date != null)
    .map((d) => ({
      date: d.date instanceof Date ? d.date : new Date(d.date),
      amount: d.amount as number,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const exDividendDateRaw = asStringOrNull(summary?.exDividendDate);

  return {
    dividendRate: asNumber(summary?.dividendRate),
    dividendYield: asNumber(summary?.dividendYield),
    trailingAnnualDividendRate: asNumber(summary?.trailingAnnualDividendRate),
    trailingAnnualDividendYield: asNumber(summary?.trailingAnnualDividendYield),
    exDividendDate: exDividendDateRaw !== null ? new Date(exDividendDateRaw) : null,
    history,
  };
}
