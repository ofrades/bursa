/**
 * Compute "simple man" performance metrics from Yahoo Finance historical data.
 * Pure price math — no AI, no opinions, just returns.
 */

export type SimpleManMetrics = {
  perfWtd: number | null; // week-to-date %
  perfLastWeek: number | null; // last full Mon–Fri %
  perfMtd: number | null; // month-to-date %
  perfLastMonth: number | null; // last calendar month %
  perfYtd: number | null; // year-to-date %
  perfLastYear: number | null; // last full calendar year %
  momentumSignal: "up" | "mixed" | "down";
  currentPrice: number | null;
  sma20: number | null;
  sma50: number | null;
  nextEarningsDate: string | null;
};

/** Format a Date as YYYY-MM-DD */
// const fmt = (d: Date) => d.toISOString().slice(0, 10)

/** Find the last closing price on or before a target date from sorted historical data */
function priceAt(
  history: Array<{ date: Date; close: number }>,
  target: Date,
): number | null {
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

export async function computeMetrics(
  symbol: string,
): Promise<SimpleManMetrics> {
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yf = new YahooFinance({
    suppressNotices: ["ripHistorical", "yahooSurvey"],
  });

  const now = new Date();

  // Fetch ~15 months of daily history to cover all periods
  const period1 = new Date(now);
  period1.setMonth(period1.getMonth() - 15);

  const [history, summary] = await Promise.all([
    (
      yf.historical(symbol, {
        period1,
        period2: now,
        interval: "1d",
      }) as Promise<any[]>
    ).catch(() => []),
    (
      yf.quoteSummary(symbol, {
        modules: ["calendarEvents", "financialData", "defaultKeyStatistics"],
      }) as Promise<any>
    ).catch(() => null),
  ]);

  const quote = (await yf.quote(symbol)) as any;
  const currentPrice: number = quote.regularMarketPrice ?? null;

  // Sort ascending
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sorted: Array<{ date: Date; close: number }> = (history as any[])
    .filter((h) => h.close != null)
    .map((h) => ({ date: new Date(h.date), close: h.close }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // ── Date anchors ──────────────────────────────────────────────────────────
  // Week-to-date: since last Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  // Last week: the Monday and Friday before last Monday
  const lastMonday = new Date(monday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const lastFriday = new Date(monday);
  lastFriday.setDate(lastFriday.getDate() - 3);

  // Month-to-date: since 1st of current month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Last month: 1st and last of previous month
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  // YTD: Jan 1 of this year
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // Last year: Jan 1 – Dec 31 of previous year
  const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
  const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31);

  // ── Price lookups ─────────────────────────────────────────────────────────
  const priceMonday = priceAt(sorted, monday);
  const priceLastMonday = priceAt(sorted, lastMonday);
  const priceLastFriday = priceAt(sorted, lastFriday);
  const priceMonthStart = priceAt(sorted, monthStart);
  const priceLastMonthStart = priceAt(sorted, lastMonthStart);
  const priceLastMonthEnd = priceAt(sorted, lastMonthEnd);
  const priceYearStart = priceAt(sorted, yearStart);
  const priceLastYearStart = priceAt(sorted, lastYearStart);
  const priceLastYearEnd = priceAt(sorted, lastYearEnd);

  const perfWtd = pct(priceMonday, currentPrice);
  const perfLastWeek = pct(priceLastMonday, priceLastFriday);
  const perfMtd = pct(priceMonthStart, currentPrice);
  const perfLastMonth = pct(priceLastMonthStart, priceLastMonthEnd);
  const perfYtd = pct(priceYearStart, currentPrice);
  const perfLastYear = pct(priceLastYearStart, priceLastYearEnd);

  // ── SMAs ─────────────────────────────────────────────────────────────────
  const recent = sorted.slice(-50).map((h) => h.close);
  const sma20 =
    recent.length >= 20
      ? recent.slice(-20).reduce((a, b) => a + b, 0) / 20
      : null;
  const sma50 =
    recent.length >= 50 ? recent.reduce((a, b) => a + b, 0) / 50 : null;

  // ── Momentum signal ───────────────────────────────────────────────────────
  const scores = [perfWtd, perfMtd, perfYtd].filter(
    (v): v is number => v != null,
  );
  const positiveCount = scores.filter((v) => v > 0).length;
  const momentumSignal: "up" | "mixed" | "down" =
    positiveCount >= 2 ? "up" : positiveCount === 0 ? "down" : "mixed";

  // ── Earnings ──────────────────────────────────────────────────────────────
  const earningsRaw = summary?.calendarEvents?.earnings?.earningsDate?.[0];
  const nextEarningsDate = earningsRaw
    ? new Date(earningsRaw).toISOString().slice(0, 10)
    : null;

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
    nextEarningsDate,
  };
}

/** Compute and upsert metrics for a symbol into the DB */
export async function refreshStockMetrics(
  symbol: string,
): Promise<SimpleManMetrics> {
  const { getDb } = await import("./db");
  const { stockMetrics } = await import("./schema");

  const metrics = await computeMetrics(symbol);
  const db = await getDb();

  await db
    .insert(stockMetrics)
    .values({
      symbol,
      ...metrics,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: stockMetrics.symbol,
      set: { ...metrics, updatedAt: new Date() },
    });

  return metrics;
}
