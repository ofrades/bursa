/**
 * Compute stock metrics from Yahoo Finance historical data.
 * Pure price math — no AI, no opinions.
 * Covers: performance, SMAs, RSI, MACD, ATR, relative volume, 52w position, fundamentals.
 */

export type SimpleManMetrics = {
  // Performance
  perfWtd: number | null;
  perfLastWeek: number | null;
  perfMtd: number | null;
  perfLastMonth: number | null;
  perfYtd: number | null;
  perfLastYear: number | null;
  momentumSignal: "up" | "mixed" | "down";
  // Price levels
  currentPrice: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  // Oscillators
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  atr14: number | null;
  // Volume
  relativeVolume: number | null;
  // 52-week position
  pct52wHigh: number | null;
  pct52wLow: number | null;
  // Fundamental
  returnOnEquity: number | null;
  revenueGrowthYoy: number | null;
  freeCashflowYield: number | null;
  // Calendar
  nextEarningsDate: string | null;
};

// ─── Math helpers ─────────────────────────────────────────────────────────────

function priceAt(history: Array<{ date: Date; close: number }>, target: Date): number | null {
  const ts = target.getTime();
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].date.getTime() <= ts) return history[i].close;
  }
  return null;
}

function pct(from: number | null, to: number | null): number | null {
  if (!from || !to) return null;
  return ((to - from) / from) * 100;
}

function sma(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  // Seed with simple average of first `period` points
  let prev = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: number[] = [prev];
  for (let i = period; i < prices.length; i++) {
    prev = prices[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function calcRsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  const changes = closes.slice(1).map((p, i) => p - closes[i]);
  let avgGain = 0;
  let avgLoss = 0;
  // Initial average over first 14 changes
  for (let i = 0; i < 14; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= 14;
  avgLoss /= 14;
  // Wilder smoothing for the rest
  for (let i = 14; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * 13 + gain) / 14;
    avgLoss = (avgLoss * 13 + loss) / 14;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcMacd(closes: number[]): {
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
} {
  if (closes.length < 35) return { macdLine: null, macdSignal: null, macdHistogram: null };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  // Align: ema26 starts at index 25, ema12 starts at index 11
  // ema26 has length = closes.length - 25, ema12 has length = closes.length - 11
  // MACD line aligns on the ema26 window
  const macdValues: number[] = [];
  const offset = 26 - 12; // 14 — ema12 is longer by this many
  for (let i = 0; i < ema26.length; i++) {
    macdValues.push(ema12[i + offset] - ema26[i]);
  }
  const signalLine = ema(macdValues, 9);
  const lastMacd = macdValues[macdValues.length - 1] ?? null;
  const lastSignal = signalLine[signalLine.length - 1] ?? null;
  return {
    macdLine: lastMacd,
    macdSignal: lastSignal,
    macdHistogram: lastMacd != null && lastSignal != null ? lastMacd - lastSignal : null,
  };
}

function calcAtr14(history: Array<{ high: number; low: number; close: number }>): number | null {
  if (history.length < 15) return null;
  const slice = history.slice(-15);
  const trs: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const { high, low } = slice[i];
    const prevClose = slice[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

// ─── Main compute ─────────────────────────────────────────────────────────────

export async function computeMetrics(symbol: string): Promise<SimpleManMetrics> {
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yf = new YahooFinance({ suppressNotices: ["ripHistorical", "yahooSurvey"] });

  const now = new Date();
  const period1 = new Date(now);
  period1.setMonth(period1.getMonth() - 15); // ~15 months for SMA200

  const [history, summary, quote] = await Promise.all([
    (yf.historical(symbol, { period1, period2: now, interval: "1d" }) as Promise<any[]>).catch(
      () => [],
    ),
    (
      yf.quoteSummary(symbol, {
        modules: ["calendarEvents", "financialData", "defaultKeyStatistics"],
      }) as Promise<any>
    ).catch(() => null),
    (yf.quote(symbol) as Promise<any>).catch(() => null),
  ]);

  const currentPrice: number = quote?.regularMarketPrice ?? null;
  const marketCap: number | null = quote?.marketCap ?? null;

  // Sort ascending, require both close AND high/low
  const sorted = (history as any[])
    .filter((h) => h.close != null && h.high != null && h.low != null)
    .map((h) => ({
      date: new Date(h.date),
      open: h.open as number,
      high: h.high as number,
      low: h.low as number,
      close: h.close as number,
      volume: (h.volume ?? 0) as number,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const closes = sorted.map((h) => h.close);
  const volumes = sorted.map((h) => h.volume);

  // ── Date anchors ────────────────────────────────────────────────────────────
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const lastMonday = new Date(monday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const lastFriday = new Date(monday);
  lastFriday.setDate(lastFriday.getDate() - 3);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
  const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31);

  const sortedSimple = sorted.map((h) => ({ date: h.date, close: h.close }));

  // ── Performance ─────────────────────────────────────────────────────────────
  const priceMonday = priceAt(sortedSimple, monday);
  const priceLastMonday = priceAt(sortedSimple, lastMonday);
  const priceLastFriday = priceAt(sortedSimple, lastFriday);
  const priceMonthStart = priceAt(sortedSimple, monthStart);
  const priceLastMonthStart = priceAt(sortedSimple, lastMonthStart);
  const priceLastMonthEnd = priceAt(sortedSimple, lastMonthEnd);
  const priceYearStart = priceAt(sortedSimple, yearStart);
  const priceLastYearStart = priceAt(sortedSimple, lastYearStart);
  const priceLastYearEnd = priceAt(sortedSimple, lastYearEnd);

  const perfWtd = pct(priceMonday, currentPrice);
  const perfLastWeek = pct(priceLastMonday, priceLastFriday);
  const perfMtd = pct(priceMonthStart, currentPrice);
  const perfLastMonth = pct(priceLastMonthStart, priceLastMonthEnd);
  const perfYtd = pct(priceYearStart, currentPrice);
  const perfLastYear = pct(priceLastYearStart, priceLastYearEnd);

  // ── Moving averages ──────────────────────────────────────────────────────────
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);

  // ── Momentum signal ──────────────────────────────────────────────────────────
  const scores = [perfWtd, perfMtd, perfYtd].filter((v): v is number => v != null);
  const positiveCount = scores.filter((v) => v > 0).length;
  const momentumSignal: "up" | "mixed" | "down" =
    positiveCount >= 2 ? "up" : positiveCount === 0 ? "down" : "mixed";

  // ── RSI ──────────────────────────────────────────────────────────────────────
  const rsi14 = calcRsi14(closes);

  // ── MACD ─────────────────────────────────────────────────────────────────────
  const { macdLine, macdSignal, macdHistogram } = calcMacd(closes);

  // ── ATR ──────────────────────────────────────────────────────────────────────
  const atr14 = calcAtr14(sorted);

  // ── Relative volume ──────────────────────────────────────────────────────────
  const avgVol5 = volumes.length >= 5 ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : null;
  const avgVol20 = volumes.length >= 20 ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const relativeVolume =
    avgVol5 != null && avgVol20 != null && avgVol20 > 0 ? avgVol5 / avgVol20 : null;

  // ── 52-week position ─────────────────────────────────────────────────────────
  const high52w: number | null = quote?.fiftyTwoWeekHigh ?? null;
  const low52w: number | null = quote?.fiftyTwoWeekLow ?? null;
  const pct52wHigh = currentPrice && high52w ? ((currentPrice - high52w) / high52w) * 100 : null;
  const pct52wLow = currentPrice && low52w ? ((currentPrice - low52w) / low52w) * 100 : null;

  // ── Fundamentals ─────────────────────────────────────────────────────────────
  const financialData = summary?.financialData ?? {};
  const returnOnEquity: number | null = financialData.returnOnEquity ?? null;
  const revenueGrowthYoy: number | null = financialData.revenueGrowth ?? null;
  const freeCashflow: number | null = financialData.freeCashflow ?? null;
  const freeCashflowYield: number | null =
    freeCashflow != null && marketCap != null && marketCap > 0
      ? (freeCashflow / marketCap) * 100
      : null;

  // ── Earnings ─────────────────────────────────────────────────────────────────
  const earningsRaw = summary?.calendarEvents?.earnings?.earningsDate?.[0];
  const nextEarningsDate = earningsRaw ? new Date(earningsRaw).toISOString().slice(0, 10) : null;

  return {
    perfWtd,
    perfLastWeek,
    perfMtd,
    perfLastMonth,
    perfYtd,
    perfLastYear,
    momentumSignal,
    currentPrice,
    sma20,
    sma50,
    sma200,
    rsi14,
    macdLine,
    macdSignal,
    macdHistogram,
    atr14,
    relativeVolume,
    pct52wHigh,
    pct52wLow,
    returnOnEquity,
    revenueGrowthYoy,
    freeCashflowYield,
    nextEarningsDate,
  };
}

/** Compute and upsert metrics for a symbol into the DB */
export async function refreshStockMetrics(symbol: string): Promise<SimpleManMetrics> {
  const { getDb } = await import("./db");
  const { stockMetrics } = await import("./schema");

  const metrics = await computeMetrics(symbol);
  const db = await getDb();

  await db
    .insert(stockMetrics)
    .values({ symbol, ...metrics, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: stockMetrics.symbol,
      set: { ...metrics, updatedAt: new Date() },
    });

  return metrics;
}
