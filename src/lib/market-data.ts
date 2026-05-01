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

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function providerFromEnv(): Provider {
  const configured = process.env.MARKET_DATA_PROVIDER?.trim().toLowerCase();
  if (configured === "yahoo") return "yahoo";
  if (configured === "fmp" && process.env.FMP_API_KEY) return "fmp";
  return process.env.FMP_API_KEY ? "fmp" : "yahoo";
}

function normalizeQuoteType(type: unknown) {
  const value = String(type ?? "").toUpperCase();
  if (value.includes("ETF")) return "ETF";
  if (value.includes("STOCK") || value.includes("EQUITY")) return "EQUITY";
  return value || undefined;
}

function normalizeHistoricalRows(payload: unknown): HistoricalPoint[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.historical)
      ? (payload as any).historical
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
    .filter((row) => !Number.isNaN(row.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function fmpGet(path: string, params: Record<string, string | number | undefined>) {
  const apiKey = process.env.FMP_API_KEY;
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
    throw new Error(`FMP request failed: ${response.status}`);
  }
  return response.json();
}

async function yahooSearchStocks(query: string): Promise<SearchResult[]> {
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const res = (await yf.search(query, { quotesCount: 8, newsCount: 0 })) as any;
  return (res.quotes as any[]).filter(
    (q) => q.quoteType === "EQUITY" || q.quoteType === "ETF",
  ) as SearchResult[];
}

async function fmpSearchStocks(query: string): Promise<SearchResult[]> {
  const rows = (await fmpGet("search-symbol", { query })) as any[];
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      symbol: String(row.symbol ?? "").toUpperCase(),
      shortname: typeof row.name === "string" ? row.name : undefined,
      longname: typeof row.name === "string" ? row.name : undefined,
      exchDisp:
        (typeof row.exchangeShortName === "string" && row.exchangeShortName) ||
        (typeof row.exchange === "string" && row.exchange) ||
        undefined,
      quoteType: normalizeQuoteType(row.type),
    }))
    .filter((row) => row.symbol && (row.quoteType === "EQUITY" || row.quoteType === "ETF"));
}

export async function searchStocks(query: string): Promise<SearchResult[]> {
  if (providerFromEnv() === "fmp") {
    try {
      return await fmpSearchStocks(query);
    } catch {
      return yahooSearchStocks(query);
    }
  }
  return yahooSearchStocks(query);
}

async function yahooGetQuote(symbol: string): Promise<QuoteData> {
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yf = new YahooFinance({ suppressNotices: ["ripHistorical", "yahooSurvey"] });
  const quote = (await yf.quote(symbol)) as any;
  return {
    regularMarketPrice: asNumber(quote?.regularMarketPrice),
    regularMarketChangePercent: asNumber(quote?.regularMarketChangePercent),
    regularMarketPreviousClose: asNumber(quote?.regularMarketPreviousClose),
    marketCap: asNumber(quote?.marketCap),
    trailingPE: asNumber(quote?.trailingPE),
    forwardPE: asNumber(quote?.forwardPE),
    fiftyTwoWeekHigh: asNumber(quote?.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: asNumber(quote?.fiftyTwoWeekLow),
    beta: asNumber(quote?.beta),
    sharesOutstanding: asNumber(quote?.sharesOutstanding),
    longName: typeof quote?.longName === "string" ? quote.longName : null,
    shortName: typeof quote?.shortName === "string" ? quote.shortName : null,
    exchange: typeof quote?.fullExchangeName === "string" ? quote.fullExchangeName : null,
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
    longName: typeof quote?.name === "string" ? quote.name : null,
    shortName: typeof quote?.name === "string" ? quote.name : null,
    exchange: typeof quote?.exchange === "string" ? quote.exchange : null,
  };
}

export async function getMarketQuote(symbol: string): Promise<QuoteData> {
  if (providerFromEnv() === "fmp") {
    try {
      return await fmpGetQuote(symbol);
    } catch {
      return yahooGetQuote(symbol);
    }
  }
  return yahooGetQuote(symbol);
}

async function yahooGetSummary(symbol: string): Promise<SummaryData> {
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yf = new YahooFinance({ suppressNotices: ["ripHistorical", "yahooSurvey"] });
  const summary = (await yf.quoteSummary(symbol, {
    modules: [
      "financialData",
      "defaultKeyStatistics",
      "calendarEvents",
      "assetProfile",
      "earningsTrend",
    ],
  })) as any;
  return {
    assetProfile: summary?.assetProfile ?? null,
    financialData: summary?.financialData ?? null,
    defaultKeyStatistics: summary?.defaultKeyStatistics ?? null,
    calendarEvents: summary?.calendarEvents ?? null,
    earningsTrend: summary?.earningsTrend ?? null,
  };
}

async function fmpGetSummary(symbol: string): Promise<SummaryData> {
  const [profileRows, ratiosRows, growthRows, estimateRows, earningsRows] = await Promise.all([
    fmpGet("profile", { symbol }).catch(() => []),
    fmpGet("ratios-ttm", { symbol }).catch(() => []),
    fmpGet("income-statement-growth", { symbol }).catch(() => []),
    fmpGet("analyst-estimates", { symbol, period: "annual", page: 0, limit: 4 }).catch(() => []),
    fmpGet("earnings-calendar", { symbol }).catch(() => []),
  ]);

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
      sector: typeof profile?.sector === "string" ? profile.sector : null,
      industry: typeof profile?.industry === "string" ? profile.industry : null,
      longBusinessSummary: typeof profile?.description === "string" ? profile.description : null,
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
  if (providerFromEnv() === "fmp") {
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
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yf = new YahooFinance({ suppressNotices: ["ripHistorical", "yahooSurvey"] });
  const interval = options.interval ?? "1d";
  const historical = (await yf.historical(symbol, {
    period1: options.period1,
    period2: options.period2,
    interval,
  })) as any[];
  return normalizeHistoricalRows(historical);
}

async function fmpGetHistoricalPrices(
  symbol: string,
  options: HistoricalOptions,
): Promise<HistoricalPoint[]> {
  const rows = await fmpGet("historical-price-eod/full", {
    symbol,
    from: options.period1.toISOString().slice(0, 10),
    to: options.period2.toISOString().slice(0, 10),
  });
  return normalizeHistoricalRows(rows);
}

export async function getHistoricalPrices(
  symbol: string,
  options: HistoricalOptions,
): Promise<HistoricalPoint[]> {
  if (providerFromEnv() === "fmp") {
    try {
      return await fmpGetHistoricalPrices(symbol, options);
    } catch {
      return yahooGetHistoricalPrices(symbol, options);
    }
  }
  return yahooGetHistoricalPrices(symbol, options);
}

async function yahooGetAnnualFinancialStatements(
  symbol: string,
  options: AnnualStatementOptions,
): Promise<FinancialStatementRow[]> {
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yf = new YahooFinance({ suppressNotices: ["ripHistorical", "yahooSurvey"] });
  const financialsRaw = await yf.fundamentalsTimeSeries(symbol, {
    period1: options.period1,
    period2: options.period2,
    type: "annual",
    module: "financials",
  });
  return Array.isArray(financialsRaw) ? (financialsRaw as FinancialStatementRow[]) : [];
}

async function fmpGetAnnualFinancialStatements(symbol: string): Promise<FinancialStatementRow[]> {
  const rows = (await fmpGet("income-statement", { symbol, period: "annual", limit: 10 })) as any[];
  return Array.isArray(rows)
    ? rows.map((row) => ({
        date: row.date,
        totalRevenue: asNumber(row.revenue ?? row.totalRevenue),
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
  if (providerFromEnv() === "fmp") {
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
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yf = new YahooFinance({ suppressNotices: ["ripHistorical", "yahooSurvey"] });
  const cashFlowRaw = await yf.fundamentalsTimeSeries(symbol, {
    period1: options.period1,
    period2: options.period2,
    type: "annual",
    module: "cash-flow",
  });
  return Array.isArray(cashFlowRaw) ? (cashFlowRaw as CashFlowStatementRow[]) : [];
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
  if (providerFromEnv() === "fmp") {
    try {
      return await fmpGetAnnualCashFlowStatements(symbol);
    } catch {
      return yahooGetAnnualCashFlowStatements(symbol, options);
    }
  }
  return yahooGetAnnualCashFlowStatements(symbol, options);
}

export function getMarketDataProviderLabel() {
  return providerFromEnv();
}

export type DividendPayment = {
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
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yf = new YahooFinance({ suppressNotices: ["ripHistorical", "yahooSurvey"] });

  const period1 = new Date();
  period1.setUTCFullYear(period1.getUTCFullYear() - 10);
  period1.setUTCMonth(0, 1);
  period1.setUTCHours(0, 0, 0, 0);

  const [chartData, summaryData] = await Promise.allSettled([
    yf.chart(symbol, {
      period1,
      period2: new Date(),
      interval: "1mo" as any,
      events: "div" as any,
    }) as any,
    yf.quoteSummary(symbol, { modules: ["summaryDetail"] }) as any,
  ]);

  const chart = chartData.status === "fulfilled" ? chartData.value : null;
  const summary = summaryData.status === "fulfilled" ? summaryData.value : null;
  const sd = summary?.summaryDetail ?? null;

  const rawDividends: Array<{ date: any; amount?: number }> = chart?.events?.dividends ?? [];

  const history: DividendPayment[] = rawDividends
    .filter((d) => d.amount != null && d.date != null)
    .map((d) => ({
      date: d.date instanceof Date ? d.date : new Date(d.date),
      amount: d.amount as number,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    dividendRate: asNumber(sd?.dividendRate),
    dividendYield: asNumber(sd?.dividendYield),
    trailingAnnualDividendRate: asNumber(sd?.trailingAnnualDividendRate),
    trailingAnnualDividendYield: asNumber(sd?.trailingAnnualDividendYield),
    exDividendDate: sd?.exDividendDate instanceof Date ? sd.exDividendDate : null,
    history,
  };
}
