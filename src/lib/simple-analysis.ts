import { z } from "zod";

import { normalizeScore } from "./analysis-normalize";

type EvidenceTone = "good" | "caution" | "bad" | "neutral";
type TrendDirection = "up" | "down" | "flat" | "mixed";
type ChartKind = "bar" | "line";
export type ValueKind = "currency" | "percent" | "ratio" | "index";

export type HistoryPoint = {
  label: string;
  date: string;
  value: number | null;
};

type ChartSeries = {
  key: string;
  label: string;
  color: string;
};

type ChartPoint = {
  label: string;
  [key: string]: string | number | null;
};

type SimpleAnalysisChart = {
  title: string;
  description?: string;
  kind: ChartKind;
  valueKind: ValueKind;
  series: ChartSeries[];
  points: ChartPoint[];
};

// Plain-language description for a metric. Surfaced as a popover/tooltip on the
// KPI tile so non-finance readers can tell what they're looking at.
type KpiMetricKey = "revenue" | "netIncome" | "freeCashFlow";

type SimpleAnalysisKpiTile = {
  metric: KpiMetricKey;
  metricLabel: string;
  metricDescription: string;
  cadence: "quarterly" | "annual";
  latest: {
    value: string;
    period: string;
    trend: TrendDirection;
    tone: EvidenceTone;
    description: string;
  };
  qoq: {
    value: string | null;
    vs: string;
    trend: TrendDirection;
    tone: EvidenceTone;
    description: string;
  };
  yoy: {
    value: string | null;
    vs: string;
    trend: TrendDirection;
    tone: EvidenceTone;
    description: string;
  };
  cagr: { value: string | null; since: string; annualised: true; description: string };
};

type SimpleAnalysisCagrRow = {
  metric: KpiMetricKey;
  metricLabel: string;
  cells: Array<{
    horizonLabel: string;
    years: number;
    cagr: string | null;
    startValue: string | null;
    endValue: string | null;
    startLabel: string | null;
    endLabel: string | null;
  }>;
};

type SimpleAnalysisStat = {
  label: string;
  value: string;
  detail?: string;
  trend: TrendDirection;
  tone: EvidenceTone;
};

export type FundamentalPosture = "supportive" | "mixed" | "strained";
type FundamentalBusinessView = "strong" | "mixed" | "weak";
type FundamentalValuationView = "attractive" | "fair" | "stretched" | "unclear";
type FundamentalBalanceSheetView = "strong" | "manageable" | "weak" | "unknown";
type FundamentalDebtServiceView = "strong" | "mixed" | "weak" | "unknown";
type FundamentalProfitabilityView = "strong" | "mixed" | "weak" | "unknown";
type FundamentalShareholderView = "friendly" | "stable" | "diluting" | "unknown";

type SCurvePosition = "early_adopter" | "crossing_chasm" | "mainstream" | "mature";
type MacroTimeHorizon = "2y" | "5y" | "10y+";
type DemandScenarioCase = "bear" | "base" | "bull";

type MacroDemandScenario = {
  case: DemandScenarioCase;
  demandDriver: string;
  demandChangePct: number | null;
  businessTransmission: string;
  earningsImpactPct: number | null;
  equityImpactPct: number | null;
  confidence?: number | null;
};

export type MacroThesis = {
  secularBet: string;
  dependencyChain: string[];
  bottleneckRole?: string | null;
  consensusBlindSpot?: string | null;
  demandGap: string;
  demandScenarios?: MacroDemandScenario[];
  repricingTriggers?: string[];
  sCurvePosition: SCurvePosition;
  timeHorizon: MacroTimeHorizon;
  loadBearingAssumptions: string[];
  falsificationSignals: string[];
  opportunityScore: number;
  confidence?: number | null;
};

export function parseMacroThesis(value: string | null | undefined): MacroThesis | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const object = z.record(z.string(), z.unknown()).safeParse(parsed);
    if (!object.success) return null;
    const thesis = parsed as MacroThesis;
    if (!z.string().safeParse(thesis.secularBet).success) return null;
    thesis.opportunityScore = normalizeScore(thesis.opportunityScore) ?? thesis.opportunityScore;
    thesis.confidence = normalizeScore(thesis.confidence);
    thesis.demandScenarios = thesis.demandScenarios?.map((scenario) => ({
      ...scenario,
      confidence: normalizeScore(scenario.confidence) ?? scenario.confidence,
    }));
    return thesis;
  } catch {
    return null;
  }
}

export type SimpleAnalysisEvidence = {
  title: string;
  summary: string;
  posture: FundamentalPosture;
  businessView: FundamentalBusinessView;
  valuationView: FundamentalValuationView;
  balanceSheetView: FundamentalBalanceSheetView;
  debtServiceView: FundamentalDebtServiceView;
  profitabilityView: FundamentalProfitabilityView;
  shareholderView: FundamentalShareholderView;
  stats: SimpleAnalysisStat[];
  charts: SimpleAnalysisChart[];
  // New top-of-page sections. Optional so old persisted rows still parse.
  kpiTiles?: SimpleAnalysisKpiTile[];
  quarterlyChart?: SimpleAnalysisChart | null;
  annualGrowthChart?: SimpleAnalysisChart | null;
  cagrTable?: {
    horizons: Array<{ label: string; years: number }>;
    rows: SimpleAnalysisCagrRow[];
  } | null;
  // Dedicated valuation card. P/E is a snapshot, not a growth rate, so it
  // doesn't belong in the CAGR table — it gets its own card placed right
  // after the CAGR table (i.e. after Revenue 1Y Growth) so the reader can
  // compare today's price tag against the growth they just saw.
  valuationCard?: {
    ttm: number | null;
    ntm: number | null;
    ttmLabel: string;
    ntmLabel: string;
    trend: TrendDirection;
    tone: EvidenceTone;
    description: string;
  } | null;
  balanceSheet?: BalanceSheetEntry[];
  takeaways: string[];
};

type BalanceSheetEntry = {
  key: "profitability" | "shareCount" | "debtLoad" | "debtService" | "cashReturn";
  label: string;
  value: string;
  description: string;
  trend: TrendDirection;
  tone: EvidenceTone;
};

export function parseSimpleAnalysisEvidence(
  value: string | null | undefined,
): SimpleAnalysisEvidence | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const object = z.record(z.string(), z.unknown()).safeParse(parsed);
    if (!object.success) return null;
    const evidence = parsed as SimpleAnalysisEvidence;
    return z.string().safeParse(evidence.title).success ? evidence : null;
  } catch {
    return null;
  }
}

export type SimpleAnalysisInputs = {
  symbol: string;
  salesHistory: HistoryPoint[];
  cashHistory: HistoryPoint[];
  priceHistory: HistoryPoint[];
  shareCountHistory: HistoryPoint[];
  currentPrice: number | null;
  marketCap: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  freeCashflow: number | null;
  ebitda: number | null;
  operatingCashflow: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  operatingMargin: number | null;
  grossMargin: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  earningsGrowth: number | null;
  peRatio: number | null;
  forwardPE: number | null;
  // Quarterly histories (last ~4y of quarters) for the new KPI tiles.
  // Optional with [] defaults so existing test fixtures keep working.
  quarterlySales?: HistoryPoint[];
  quarterlyNetIncome?: HistoryPoint[];
  quarterlyFcf?: HistoryPoint[];
};

function compactCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function percentLabel(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

function ratioPercentLabel(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function cleanHistory(points: HistoryPoint[]) {
  return points
    .filter((point) => point.label)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── Plain-English descriptions for the KPI section ───────────────────────────
// These are surfaced on every KPI tile and growth chart as a "?" popover so
// non-finance readers can tell what they're looking at. Keep them short — two
// sentences max. Edit here, not in the components.
const KPI_DESCRIPTIONS = {
  revenue:
    "The total dollars the company billed customers. When this number grows quarter after quarter, the business is finding more demand.",
  netIncome:
    "What's left from revenue after paying every cost — employees, materials, taxes, interest. Sometimes called profit or 'the bottom line.'",
  freeCashFlow:
    "The cash actually left in the bank after the company has paid for everything and reinvested in itself. Harder to fake than net income.",
} as const;

const KPI_TERM_DESCRIPTIONS = {
  latest: "The most recent reported figure, in the company's own currency and reporting cadence.",
  qoq: "How much this quarter grew compared to last quarter. Useful for spotting acceleration or slowdown in real time.",
  yoy: "How much this quarter grew compared to the same quarter one year ago. Strips out seasonality — a slow holiday quarter looks worse QoQ but normal YoY.",
  cagr: "The smooth yearly growth rate that gets you from the starting value to the current value. A 100% CAGR over 3 years means the business tripled, on average, each year.",
  priceVsBusiness:
    "All three lines start at 100 so you can compare the slope of the stock against the slope of sales and cash. If price climbs faster than the lines underneath it, you're paying for growth that hasn't shown up yet.",
  valuation:
    "Price divided by yearly earnings per share — how many years of today's profits the price tag represents. Higher isn't worse, but it leaves less room for disappointment.",
} satisfies Record<"latest" | "qoq" | "yoy" | "cagr" | "priceVsBusiness" | "valuation", string>;

function getFirstAndLast(points: HistoryPoint[]) {
  const valid = points.filter((point) => point.value != null && Number.isFinite(point.value));
  if (valid.length < 2) return null;
  return { first: valid[0].value as number, last: valid[valid.length - 1].value as number };
}

function getGrowth(points: HistoryPoint[]) {
  const edge = getFirstAndLast(points);
  if (!edge || edge.first === 0) return null;
  return ((edge.last - edge.first) / Math.abs(edge.first)) * 100;
}

// ─── Annualised growth helpers ───────────────────────────────────────────────
// CAGR: geometric mean growth rate between first and last. Years is fractional
// (4.0 for a 4-year window). Returns null when inputs are not usable.
// @internal — exported for unit tests; not part of the public API.
export function cagr(first: number, last: number, years: number): number | null {
  if (!Number.isFinite(first) || !Number.isFinite(last) || !Number.isFinite(years)) return null;
  if (first <= 0 || years <= 0) return null;
  if (last <= 0) return null; // can't take a root of a negative
  return (Math.pow(last / first, 1 / years) - 1) * 100;
}

// Per-point QoQ growth: thisQ / prevQ - 1, expressed as %. First point is null
// (no prior quarter).
// @internal
export function qoqGrowth(series: Array<number | null | undefined>): Array<number | null> {
  return series.map((value, i) => {
    if (i === 0) return null;
    const prev = series[i - 1];
    if (prev == null || value == null || prev <= 0) return null;
    return ((value - prev) / prev) * 100;
  });
}

// Per-point YoY growth: thisQ / sameQ4Ago - 1. Earlier points stay null.
// @internal
export function yoyGrowth(series: Array<number | null | undefined>): Array<number | null> {
  return series.map((value, i) => {
    if (i < 4) return null;
    const base = series[i - 4];
    if (base == null || value == null || base <= 0) return null;
    return ((value - base) / base) * 100;
  });
}

// Window from the end: CAGR over the last `years`. Returns null when the
// available history doesn't cover the requested window — that prevents every
// horizon column from collapsing onto the same single-period growth rate
// when the data is too sparse (which is what we used to do, and it made
// "3 yr" / "2 yr" / "1 yr" look identical for thinly-reported tickers).
// Returns { cagr, start, end, startLabel, endLabel, years } so the UI can
// show the start → end values alongside the percentage.
// @internal
export function horizonCagr(
  points: HistoryPoint[],
  years: number,
): {
  cagr: number | null;
  start: number;
  end: number;
  startLabel: string;
  endLabel: string;
  years: number;
} | null {
  const valid = points.filter(
    (point) =>
      point.value != null && Number.isFinite(point.value as number) && (point.value as number) > 0,
  );
  if (valid.length < 2) return null;
  const endPoint = valid[valid.length - 1];
  const endValue = endPoint.value as number;
  const endDate = new Date(endPoint.date);
  const cutoff = new Date(endDate);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  // Walk back until we cross the cutoff. We use the first point whose date is
  // strictly at or after `cutoff` (oldest in the window).
  const inWindow = valid.filter((point) => new Date(point.date).getTime() >= cutoff.getTime());
  // Need at least 2 points in the window to compute a meaningful CAGR. If we
  // don't, return null — the UI renders "—" rather than a fake number that
  // happens to match whatever other column we're rendering next to it.
  if (inWindow.length < 2) return null;
  const startPoint = inWindow[0];
  const startValue = startPoint.value as number;
  const startDate = new Date(startPoint.date);
  const actualYears = Math.max(
    (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
    0.01,
  );
  // Belt-and-braces: if the actual data span is meaningfully shorter than
  // the requested horizon (e.g. we asked for 3 years but only have 1), the
  // CAGR would just be the 1-year rate labelled as "3 yr" — exactly the bug
  // we hit. Bail out and let the cell render "—". We allow a 25% tolerance
  // so that, say, a 2.8-year span still answers a 3-year request.
  if (actualYears < years * 0.75) return null;
  return {
    cagr: cagr(startValue, endValue, actualYears),
    start: startValue,
    end: endValue,
    startLabel: startPoint.label,
    endLabel: endPoint.label,
    years: actualYears,
  };
}

function getTrend(points: HistoryPoint[]): TrendDirection {
  const growth = getGrowth(points);
  if (growth == null) return "mixed";
  if (growth >= 8) return "up";
  if (growth <= -8) return "down";
  return "flat";
}

function describeDebtLoad(totalDebt: number | null, totalCash: number | null) {
  if (totalDebt == null || totalCash == null || totalCash <= 0) {
    return {
      value: "Unknown",
      detail: "Not enough debt data",
      tone: "neutral" as const,
    };
  }

  const ratio = totalDebt / totalCash;

  if (ratio <= 1) {
    return {
      value: "Light",
      detail: `Debt is covered by cash (${ratio.toFixed(1)}x).`,
      tone: "good" as const,
    };
  }

  if (ratio <= 2) {
    return {
      value: "Manageable",
      detail: `Debt is ${ratio.toFixed(1)}x cash.`,
      tone: "caution" as const,
    };
  }

  return {
    value: "Heavy",
    detail: `Debt is ${ratio.toFixed(1)}x cash.`,
    tone: "bad" as const,
  };
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function normalizeHistory(points: HistoryPoint[]) {
  const valid = cleanHistory(points);
  const first = valid.find(
    (point) => point.value != null && Number.isFinite(point.value) && point.value > 0,
  );
  if (!first || first.value == null) {
    return valid.map((point) => ({ label: point.label, value: null }));
  }

  const base = first.value;

  return valid.map((point) => ({
    label: point.label,
    value: point.value != null && Number.isFinite(point.value) ? (point.value / base) * 100 : null,
  }));
}

function describeProfitability(input: {
  operatingMargin: number | null;
  grossMargin: number | null;
  profitMargin: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  earningsGrowth: number | null;
}) {
  let signals = 0;
  let score = 0;

  if (input.operatingMargin != null) {
    signals += 1;
    if (input.operatingMargin >= 0.18) score += 1;
    else if (input.operatingMargin <= 0.08) score -= 1;
  }

  if (input.profitMargin != null) {
    signals += 1;
    if (input.profitMargin >= 0.12) score += 1;
    else if (input.profitMargin <= 0.04) score -= 1;
  }

  if (input.grossMargin != null) {
    signals += 1;
    if (input.grossMargin >= 0.4) score += 1;
    else if (input.grossMargin <= 0.2) score -= 1;
  }

  if (input.returnOnEquity != null) {
    signals += 1;
    if (input.returnOnEquity >= 0.15) score += 1;
    else if (input.returnOnEquity <= 0.08) score -= 1;
  }

  if (input.returnOnAssets != null) {
    signals += 1;
    if (input.returnOnAssets >= 0.06) score += 1;
    else if (input.returnOnAssets <= 0.02) score -= 1;
  }

  if (input.earningsGrowth != null) {
    signals += 1;
    if (input.earningsGrowth >= 0.08) score += 1;
    else if (input.earningsGrowth <= -0.05) score -= 1;
  }

  const detailParts = [
    input.operatingMargin != null ? `Op margin ${ratioPercentLabel(input.operatingMargin)}` : null,
    input.profitMargin != null ? `Net margin ${ratioPercentLabel(input.profitMargin)}` : null,
    input.grossMargin != null ? `Gross margin ${ratioPercentLabel(input.grossMargin)}` : null,
    input.returnOnEquity != null ? `ROE ${ratioPercentLabel(input.returnOnEquity)}` : null,
    input.returnOnAssets != null ? `ROA ${ratioPercentLabel(input.returnOnAssets)}` : null,
    input.earningsGrowth != null ? `EPS growth ${ratioPercentLabel(input.earningsGrowth)}` : null,
  ].filter(Boolean);

  if (signals === 0) {
    return {
      value: "Unknown",
      detail: "Not enough quality data",
      tone: "neutral" as const,
      view: "unknown" as const,
    };
  }

  if (score >= 2) {
    return {
      value: "Strong",
      detail: detailParts.join(" · "),
      tone: "good" as const,
      view: "strong" as const,
    };
  }

  if (score <= -2) {
    return {
      value: "Weak",
      detail: detailParts.join(" · "),
      tone: "bad" as const,
      view: "weak" as const,
    };
  }

  return {
    value: "Mixed",
    detail: detailParts.join(" · "),
    tone: "caution" as const,
    view: "mixed" as const,
  };
}

function describeShareholderTrend(points: HistoryPoint[]) {
  const shareGrowth = getGrowth(points);

  if (shareGrowth == null) {
    return {
      value: "Unknown",
      detail: "Not enough share-count history",
      tone: "neutral" as const,
      view: "unknown" as const,
    };
  }

  if (shareGrowth >= 8) {
    return {
      value: "Diluting",
      detail: `Diluted shares are up ${Math.abs(shareGrowth).toFixed(0)}% over the view shown.`,
      tone: "bad" as const,
      view: "diluting" as const,
    };
  }

  if (shareGrowth <= -3) {
    return {
      value: "Shrinking",
      detail: `Diluted shares are down ${Math.abs(shareGrowth).toFixed(0)}% over the view shown.`,
      tone: "good" as const,
      view: "friendly" as const,
    };
  }

  return {
    value: "Stable",
    detail: `Diluted shares are roughly flat (${Math.abs(shareGrowth).toFixed(0)}% change).`,
    tone: "neutral" as const,
    view: "stable" as const,
  };
}

function describeDebtService(input: {
  totalDebt: number | null;
  freeCashflow: number | null;
  ebitda: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  operatingCashflow: number | null;
}) {
  const debtToFcf =
    input.totalDebt != null && input.freeCashflow != null && input.freeCashflow > 0
      ? input.totalDebt / input.freeCashflow
      : null;
  const debtToEbitda =
    input.totalDebt != null && input.ebitda != null && input.ebitda > 0
      ? input.totalDebt / input.ebitda
      : null;
  const liquidity = input.quickRatio ?? input.currentRatio;

  const detailParts = [
    debtToFcf != null ? `Debt/FCF ${debtToFcf.toFixed(1)}x` : null,
    debtToEbitda != null ? `Debt/EBITDA ${debtToEbitda.toFixed(1)}x` : null,
    liquidity != null ? `Liquidity ${liquidity.toFixed(1)}x` : null,
    input.operatingCashflow != null ? `Op cash ${compactCurrency(input.operatingCashflow)}` : null,
  ].filter(Boolean);

  if (detailParts.length === 0) {
    return {
      value: "Unknown",
      detail: "Not enough debt-service data",
      tone: "neutral" as const,
      view: "unknown" as const,
      debtToFcf,
      debtToEbitda,
      liquidity,
    };
  }

  const clearlyWeak =
    (debtToFcf != null && debtToFcf > 8) ||
    (debtToEbitda != null && debtToEbitda > 5) ||
    (liquidity != null && liquidity < 0.9) ||
    (input.totalDebt != null &&
      input.totalDebt > 0 &&
      input.freeCashflow != null &&
      input.freeCashflow <= 0);

  if (clearlyWeak) {
    return {
      value: "Weak",
      detail: detailParts.join(" · "),
      tone: "bad" as const,
      view: "weak" as const,
      debtToFcf,
      debtToEbitda,
      liquidity,
    };
  }

  const clearlyStrong =
    ((debtToFcf != null && debtToFcf <= 3) || (debtToEbitda != null && debtToEbitda <= 2.5)) &&
    (liquidity == null || liquidity >= 1.2);

  if (clearlyStrong) {
    return {
      value: "Strong",
      detail: detailParts.join(" · "),
      tone: "good" as const,
      view: "strong" as const,
      debtToFcf,
      debtToEbitda,
      liquidity,
    };
  }

  return {
    value: "Mixed",
    detail: detailParts.join(" · "),
    tone: "caution" as const,
    view: "mixed" as const,
    debtToFcf,
    debtToEbitda,
    liquidity,
  };
}

export function buildSimpleAnalysisEvidence(
  input: SimpleAnalysisInputs,
): SimpleAnalysisEvidence | null {
  const salesHistory = cleanHistory(input.salesHistory).slice(-5);
  const cashHistory = cleanHistory(input.cashHistory).slice(-5);
  const priceHistory = cleanHistory(input.priceHistory).slice(-5);
  const shareCountHistory = cleanHistory(input.shareCountHistory).slice(-5);

  if (!salesHistory.length && !cashHistory.length && !priceHistory.length) {
    return null;
  }

  const salesTrend = getTrend(salesHistory);
  const cashTrend = getTrend(cashHistory);
  const priceTrend = getTrend(priceHistory);

  const salesGrowth = getGrowth(salesHistory);
  const cashGrowth = getGrowth(cashHistory);
  const priceGrowth = getGrowth(priceHistory);
  const businessGrowth = average([salesGrowth, cashGrowth]);
  const priceGap =
    priceGrowth != null && businessGrowth != null ? priceGrowth - businessGrowth : null;

  const latestSales = salesHistory.at(-1)?.value ?? null;
  const latestCash = cashHistory.at(-1)?.value ?? null;
  const debtLoad = describeDebtLoad(input.totalDebt, input.totalCash);
  const debtService = describeDebtService({
    totalDebt: input.totalDebt,
    freeCashflow: input.freeCashflow,
    ebitda: input.ebitda,
    currentRatio: input.currentRatio,
    quickRatio: input.quickRatio,
    operatingCashflow: input.operatingCashflow,
  });
  const profitability = describeProfitability({
    operatingMargin: input.operatingMargin,
    grossMargin: input.grossMargin,
    profitMargin: input.profitMargin,
    returnOnEquity: input.returnOnEquity,
    returnOnAssets: input.returnOnAssets,
    earningsGrowth: input.earningsGrowth,
  });
  const shareholderTrend = describeShareholderTrend(shareCountHistory);
  const cashReturnAtPrice =
    input.freeCashflow != null && input.marketCap != null && input.marketCap > 0
      ? (input.freeCashflow / input.marketCap) * 100
      : null;
  const cheapPe =
    (input.peRatio != null && input.peRatio > 0 && input.peRatio <= 18) ||
    (input.forwardPE != null && input.forwardPE > 0 && input.forwardPE <= 16);
  const richPe =
    (input.peRatio != null && input.peRatio >= 35) ||
    (input.forwardPE != null && input.forwardPE >= 30);

  const priceVsBusinessLabel =
    priceGap == null
      ? "hard to tell"
      : priceGap > 25
        ? "ahead"
        : priceGap < -15
          ? "behind"
          : "in step";

  const businessView: FundamentalBusinessView =
    salesTrend === "up" &&
    (cashTrend === "up" || (latestCash != null && latestCash > 0)) &&
    profitability.view !== "weak"
      ? "strong"
      : salesTrend === "down" &&
          (cashTrend === "down" || (latestCash != null && latestCash < 0)) &&
          profitability.view !== "strong"
        ? "weak"
        : "mixed";

  const valuationView: FundamentalValuationView =
    cashReturnAtPrice == null && priceVsBusinessLabel === "hard to tell" && !cheapPe && !richPe
      ? "unclear"
      : (cashReturnAtPrice != null && cashReturnAtPrice >= 6) ||
          priceVsBusinessLabel === "behind" ||
          cheapPe
        ? "attractive"
        : (cashReturnAtPrice != null && cashReturnAtPrice < 3) ||
            priceVsBusinessLabel === "ahead" ||
            richPe
          ? "stretched"
          : "fair";

  const balanceSheetView: FundamentalBalanceSheetView =
    debtLoad.tone === "good"
      ? "strong"
      : debtLoad.tone === "bad"
        ? "weak"
        : debtLoad.tone === "caution"
          ? "manageable"
          : "unknown";

  const posture: FundamentalPosture =
    businessView === "strong" &&
    valuationView !== "stretched" &&
    balanceSheetView !== "weak" &&
    debtService.view !== "weak" &&
    profitability.view !== "weak" &&
    shareholderTrend.view !== "diluting"
      ? "supportive"
      : businessView === "weak" &&
          (valuationView === "stretched" ||
            balanceSheetView === "weak" ||
            debtService.view === "weak" ||
            profitability.view === "weak")
        ? "strained"
        : "mixed";

  const businessPhrase =
    salesTrend === "up" && cashTrend === "up"
      ? "Sales and cash left over are both moving up"
      : salesTrend === "up"
        ? "Sales are rising, but cash is less convincing"
        : cashTrend === "up"
          ? "Cash is improving, but sales are less steady"
          : "The business trend is not clearly improving";

  const pricePhrase =
    priceVsBusinessLabel === "ahead"
      ? "the stock price has run ahead of the business"
      : priceVsBusinessLabel === "behind"
        ? "the business has improved faster than the stock price"
        : "price and business have mostly moved together";

  const safetyPhrase =
    debtLoad.tone === "good"
      ? "debt looks light"
      : debtLoad.tone === "bad"
        ? "debt looks heavy"
        : "debt looks manageable";

  const stats: SimpleAnalysisStat[] = [
    {
      label: "Sales",
      value: compactCurrency(latestSales),
      detail:
        salesGrowth != null
          ? `${salesTrend === "up" ? "Up" : salesTrend === "down" ? "Down" : "Flat"} ${Math.abs(salesGrowth).toFixed(0)}% over the view shown.`
          : "Sales trend is limited.",
      trend: salesTrend,
      tone: salesTrend === "up" ? "good" : salesTrend === "down" ? "bad" : "neutral",
    },
    {
      label: "Cash left after bills",
      value: compactCurrency(latestCash),
      detail:
        cashGrowth != null
          ? `${cashTrend === "up" ? "Up" : cashTrend === "down" ? "Down" : "Flat"} ${Math.abs(cashGrowth).toFixed(0)}% over the view shown.`
          : "Cash trend is limited.",
      trend: cashTrend,
      tone:
        latestCash != null && latestCash < 0
          ? "bad"
          : cashTrend === "up"
            ? "good"
            : cashTrend === "down"
              ? "bad"
              : "neutral",
    },
    {
      label: "Profitability",
      value: profitability.value,
      detail: profitability.detail,
      trend:
        profitability.view === "strong"
          ? "up"
          : profitability.view === "weak"
            ? "down"
            : profitability.view === "unknown"
              ? "mixed"
              : "flat",
      tone: profitability.tone,
    },
    {
      label: "Share count",
      value: shareholderTrend.value,
      detail: shareholderTrend.detail,
      trend:
        shareholderTrend.view === "friendly"
          ? "up"
          : shareholderTrend.view === "diluting"
            ? "down"
            : shareholderTrend.view === "unknown"
              ? "mixed"
              : "flat",
      tone: shareholderTrend.tone,
    },
    {
      label: "Debt load",
      value: debtLoad.value,
      detail: debtLoad.detail,
      trend: debtLoad.tone === "bad" ? "down" : debtLoad.tone === "good" ? "up" : "flat",
      tone: debtLoad.tone,
    },
    {
      label: "Debt service",
      value: debtService.value,
      detail: debtService.detail,
      trend:
        debtService.view === "strong"
          ? "up"
          : debtService.view === "weak"
            ? "down"
            : debtService.view === "unknown"
              ? "mixed"
              : "flat",
      tone: debtService.tone,
    },
    {
      label: "Cash return at today's price",
      value: percentLabel(cashReturnAtPrice),
      detail:
        cashReturnAtPrice == null
          ? input.peRatio != null || input.forwardPE != null
            ? `P/E ${input.peRatio?.toFixed(1) ?? "—"} · Fwd P/E ${input.forwardPE?.toFixed(1) ?? "—"}`
            : "Could not compare price to cash."
          : cashReturnAtPrice >= 6
            ? "Strong cash return for the price paid today."
            : cashReturnAtPrice >= 3
              ? "Okay, but not especially cheap."
              : "Thin cash return for the price paid today.",
      trend:
        cashReturnAtPrice == null
          ? richPe
            ? "down"
            : cheapPe
              ? "up"
              : "mixed"
          : cashReturnAtPrice >= 6
            ? "up"
            : cashReturnAtPrice < 3
              ? "down"
              : "flat",
      tone:
        cashReturnAtPrice == null
          ? richPe
            ? "bad"
            : cheapPe
              ? "good"
              : "neutral"
          : cashReturnAtPrice >= 6
            ? "good"
            : cashReturnAtPrice < 3
              ? "bad"
              : "caution",
    },
  ];

  const salesChart: SimpleAnalysisChart | null = salesHistory.length
    ? {
        title: "Sales trend",
        description: "Bigger sales over time usually mean the business is finding more demand.",
        kind: "bar",
        valueKind: "currency",
        series: [{ key: "sales", label: "Sales", color: "var(--chart-1)" }],
        points: salesHistory.map((point) => ({ label: point.label, sales: point.value })),
      }
    : null;

  const cashChart: SimpleAnalysisChart | null = cashHistory.length
    ? {
        title: "Cash left after bills",
        description: "This is the money left after running and reinvesting in the business.",
        kind: "bar",
        valueKind: "currency",
        series: [{ key: "cash", label: "Cash left after bills", color: "var(--chart-2)" }],
        points: cashHistory.map((point) => ({ label: point.label, cash: point.value })),
      }
    : null;

  const normalizedSales = normalizeHistory(salesHistory);
  const normalizedCash = normalizeHistory(cashHistory);
  const normalizedPrice = normalizeHistory(priceHistory);
  const labels = Array.from(
    new Set([
      ...normalizedSales.map((point) => point.label),
      ...normalizedCash.map((point) => point.label),
      ...normalizedPrice.map((point) => point.label),
    ]),
  );

  const priceVsBusinessChart: SimpleAnalysisChart | null = labels.length
    ? {
        title: "Price vs business",
        description: "All lines start at 100 so you can compare direction instead of raw size.",
        kind: "line",
        valueKind: "index",
        series: [
          { key: "price", label: "Stock price", color: "var(--chart-3)" },
          { key: "sales", label: "Sales", color: "var(--chart-1)" },
          { key: "cash", label: "Cash left after bills", color: "var(--chart-2)" },
        ],
        points: labels.map((label) => ({
          label,
          price: normalizedPrice.find((point) => point.label === label)?.value ?? null,
          sales: normalizedSales.find((point) => point.label === label)?.value ?? null,
          cash: normalizedCash.find((point) => point.label === label)?.value ?? null,
        })),
      }
    : null;

  const takeaways = [
    `${businessPhrase}.`,
    `Over the same view, ${pricePhrase}.`,
    `${safetyPhrase[0]?.toUpperCase() ?? ""}${safetyPhrase.slice(1)}.`,
  ];

  if (profitability.view === "strong") {
    takeaways.push(`Margins and returns still show a strong operating engine.`);
  } else if (profitability.view === "weak") {
    takeaways.push(`Margins, returns, or earnings quality still need work.`);
  }

  if (debtService.view === "strong") {
    takeaways.push(`Debt service still looks controlled against cash generation.`);
  } else if (debtService.view === "weak") {
    takeaways.push(`Debt service looks stretched for the cash this business is producing.`);
  }

  if (shareholderTrend.view === "diluting") {
    takeaways.push(`Share count has been rising, which can dilute per-share gains.`);
  } else if (shareholderTrend.view === "friendly") {
    takeaways.push(`Share count has been shrinking, which helps per-share ownership.`);
  }

  if (input.currentPrice != null && priceTrend !== "mixed") {
    takeaways.push(
      `Recent market trend is ${priceTrend === "up" ? "helping" : priceTrend === "down" ? "working against" : "mostly flat for"} buyers at around ${compactCurrency(input.currentPrice)}.`,
    );
  }

  return {
    title: "Business backdrop",
    summary: "Sales, cash, margins, dilution, balance sheet, and valuation.",
    posture,
    businessView,
    valuationView,
    balanceSheetView,
    debtServiceView: debtService.view,
    profitabilityView: profitability.view,
    shareholderView: shareholderTrend.view,
    stats,
    charts: [salesChart, cashChart, priceVsBusinessChart].filter(
      (chart): chart is SimpleAnalysisChart => chart != null,
    ),
    takeaways: takeaways.slice(0, 4),
    // ── New top-of-page sections ─────────────────────────────────────────────
    kpiTiles: buildKpiTiles(input),
    quarterlyChart: buildQuarterlyGrowthChart(input),
    annualGrowthChart: buildAnnualGrowthChart(input),
    cagrTable: buildCagrTable(input),
    valuationCard: buildValuationCard(input),
    balanceSheet: buildBalanceSheet(input),
  };
}

// ─── New KPI tiles / growth chart / CAGR table ───────────────────────────────

type KpiMetric = {
  key: KpiMetricKey;
  label: string;
  history: HistoryPoint[];
};

function pickKpiMetrics(input: SimpleAnalysisInputs): KpiMetric[] {
  return [
    { key: "revenue", label: "Revenue", history: input.quarterlySales ?? [] },
    { key: "netIncome", label: "Net income", history: input.quarterlyNetIncome ?? [] },
    {
      key: "freeCashFlow",
      label: "Free cash flow",
      // Fall back to annual FCF if quarterly isn't available. The cadence label
      // will then say "annual" so the user knows.
      history: (input.quarterlyFcf ?? []).length ? (input.quarterlyFcf ?? []) : input.cashHistory,
    },
  ];
}

function buildKpiTiles(input: SimpleAnalysisInputs): SimpleAnalysisKpiTile[] {
  const metrics = pickKpiMetrics(input);
  const tiles: SimpleAnalysisKpiTile[] = [];

  for (const metric of metrics) {
    const cleaned = cleanHistory(metric.history).filter(
      (p) => p.value != null && Number.isFinite(p.value as number),
    );
    if (cleaned.length < 2) continue; // need at least 2 points for any growth math
    const cadence: "quarterly" | "annual" =
      metric.key === "freeCashFlow" && !(input.quarterlyFcf ?? []).length ? "annual" : "quarterly";
    const values = cleaned.map((p) => p.value as number);
    const labels = cleaned.map((p) => p.label);

    const latest = cleaned[cleaned.length - 1];
    const prior = cleaned[cleaned.length - 2];
    const yoyBase = cleaned.length >= 5 ? cleaned[cleaned.length - 5] : null;

    const qoqSeries = qoqGrowth(values);
    const yoySeries = yoyGrowth(values);
    const qoqValue = qoqSeries[qoqSeries.length - 1] ?? null;
    const yoyValue = yoySeries[yoySeries.length - 1] ?? null;

    // CAGR: prefer a 3-year window when we have at least ~3y of history.
    const cagrWindow = horizonCagr(cleaned, 3);

    tiles.push({
      metric: metric.key,
      metricLabel: metric.label,
      metricDescription: KPI_DESCRIPTIONS[metric.key],
      cadence,
      latest: {
        value: compactCurrency(latest.value),
        period: latest.label,
        trend:
          prior == null || prior.value == null || (prior.value as number) === 0
            ? "mixed"
            : ((latest.value as number) - (prior.value as number)) /
                  Math.abs(prior.value as number) >=
                0
              ? "up"
              : "down",
        tone: "neutral",
        description: KPI_TERM_DESCRIPTIONS.latest,
      },
      qoq: {
        value: qoqValue == null ? null : `${qoqValue >= 0 ? "+" : ""}${qoqValue.toFixed(1)}%`,
        vs: prior ? `vs ${prior.label}` : "",
        trend: qoqValue == null ? "mixed" : qoqValue >= 5 ? "up" : qoqValue <= -5 ? "down" : "flat",
        tone:
          qoqValue == null
            ? "neutral"
            : qoqValue >= 5
              ? "good"
              : qoqValue <= -5
                ? "bad"
                : "neutral",
        description: KPI_TERM_DESCRIPTIONS.qoq,
      },
      yoy: {
        value: yoyValue == null ? null : `${yoyValue >= 0 ? "+" : ""}${yoyValue.toFixed(1)}%`,
        vs: yoyBase ? `vs ${yoyBase.label}` : "",
        trend:
          yoyValue == null ? "mixed" : yoyValue >= 10 ? "up" : yoyValue <= -10 ? "down" : "flat",
        tone:
          yoyValue == null
            ? "neutral"
            : yoyValue >= 10
              ? "good"
              : yoyValue <= -10
                ? "bad"
                : "neutral",
        description: KPI_TERM_DESCRIPTIONS.yoy,
      },
      cagr: {
        value:
          cagrWindow?.cagr == null
            ? null
            : `${cagrWindow.cagr >= 0 ? "+" : ""}${cagrWindow.cagr.toFixed(1)}% annualised`,
        since: cagrWindow
          ? `since ${cagrWindow.startLabel} · ${cagrWindow.years.toFixed(1)}y`
          : "insufficient history",
        annualised: true,
        description: KPI_TERM_DESCRIPTIONS.cagr,
      },
    });
    // references unused variable to keep TS happy
    void labels;
  }

  return tiles;
}

// Dedicated valuation card. P/E is a ratio (price ÷ earnings), not a growth
// rate, so it doesn't fit the CAGR table's row/column shape. It gets its own
// card placed right after the CAGR table so the reader can compare today's
// price tag against the growth they just saw in the 1Y/2Y/3Y columns.
function buildValuationCard(input: SimpleAnalysisInputs): SimpleAnalysisEvidence["valuationCard"] {
  const ttm = input.peRatio;
  const ntm = input.forwardPE;
  if (ttm == null && ntm == null) return null;
  // Forward P/E (NTM) is the more decision-relevant of the two — it bakes in
  // the consensus expectation of next year's earnings. We tone the card on
  // NTM when we have it, otherwise on TTM.
  const ref = ntm ?? ttm ?? 0;
  // Trend: forward below trailing = earnings expected to grow = good. Equal
  // means consensus is flat. Forward above trailing = expected contraction.
  const trend: TrendDirection =
    ttm == null || ntm == null
      ? "mixed"
      : ntm < ttm * 0.95
        ? "up"
        : ntm > ttm * 1.05
          ? "down"
          : "flat";
  // Tone buckets on the reference P/E. Below 15 is "cheap" relative to the
  // broad market, 25-35 is "you'd better believe in the growth story",
  // above 35 is "priced for perfection or bubbly".
  const tone: EvidenceTone =
    ref === 0 ? "neutral" : ref < 15 ? "good" : ref < 25 ? "neutral" : ref < 35 ? "caution" : "bad";
  return {
    ttm,
    ntm,
    ttmLabel: ttm != null ? ttm.toFixed(1) : "—",
    ntmLabel: ntm != null ? ntm.toFixed(1) : "—",
    trend,
    tone,
    description: KPI_TERM_DESCRIPTIONS.valuation,
  };
}

function buildQuarterlyGrowthChart(input: SimpleAnalysisInputs): SimpleAnalysisChart | null {
  // Bars: quarterly absolute values for revenue + net income. FCF only joins
  // if we actually have quarterly FCF data (sparse on Yahoo).
  const labels = cleanHistory(input.quarterlySales ?? []).map((p) => p.label);
  if (labels.length < 2) return null;
  const salesValues = cleanHistory(input.quarterlySales ?? []).map((p) => p.value as number | null);
  const niValues = cleanHistory(input.quarterlyNetIncome ?? []).map(
    (p) => p.value as number | null,
  );
  const fcfValues = cleanHistory(input.quarterlyFcf ?? []).map((p) => p.value as number | null);
  const hasFcf = fcfValues.some((v) => v != null);

  const series: ChartSeries[] = [
    { key: "revenue", label: "Revenue", color: "var(--chart-1)" },
    { key: "netIncome", label: "Net income", color: "var(--chart-2)" },
  ];
  if (hasFcf) {
    series.push({ key: "freeCashFlow", label: "Free cash flow", color: "var(--chart-3)" });
  }

  const points = labels.map((label, idx) => {
    const point = {
      label,
      revenue: salesValues[idx] ?? null,
      netIncome: niValues[idx] ?? null,
    };
    return hasFcf ? { ...point, freeCashFlow: fcfValues[idx] ?? null } : point;
  });

  return {
    title: "Quarterly revenue, net income & free cash flow",
    description:
      "Bars show what the company actually reported each quarter. The growth chart below turns these into the QoQ / YoY pace the rest of this page uses.",
    kind: "bar",
    valueKind: "currency",
    series,
    points,
  };
}

// YoY growth chart from ANNUAL history. Quarterly data only spans ~1y on most
// tickers, so a quarterly YoY bar chart ends up with a single meaningful bar.
// The annual view gives 4-5 years of history, which is what users actually want
// for spotting multi-year trend.
function buildAnnualGrowthChart(input: SimpleAnalysisInputs): SimpleAnalysisChart | null {
  const sales = cleanHistory(input.salesHistory);
  const cash = cleanHistory(input.cashHistory);
  // We need at least 2 full years to compute a YoY% — anything less is noise.
  if (sales.length < 2 && cash.length < 2) return null;

  // Align both series by label so the bars share x-axis. If labels don't
  // overlap perfectly, we just include the union.
  const labelSet = new Set<string>([...sales.map((p) => p.label), ...cash.map((p) => p.label)]);
  const labels = Array.from(labelSet).sort();
  const salesByLabel = new Map(sales.map((p) => [p.label, p]));
  const cashByLabel = new Map(cash.map((p) => [p.label, p]));

  const yoy = (prev: number | null | undefined, cur: number | null | undefined): number | null => {
    if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur)) return null;
    if (prev === 0) return null;
    return ((cur - prev) / Math.abs(prev)) * 100;
  };

  const points: ChartPoint[] = labels.map((label, i) => {
    const curSales = salesByLabel.get(label)?.value as number | null;
    const prevSales =
      sales[i - 1] != null ? (salesByLabel.get(labels[i - 1])?.value as number | null) : null;
    const curCash = cashByLabel.get(label)?.value as number | null;
    const prevCash =
      cash[i - 1] != null ? (cashByLabel.get(labels[i - 1])?.value as number | null) : null;
    return {
      label,
      revenue: yoy(prevSales, curSales),
      freeCashFlow: yoy(prevCash, curCash),
    };
  });
  // Drop leading row (no prior year) and any all-null rows.
  const usable = points.slice(1).filter((p) => p.revenue != null || p.freeCashFlow != null);
  if (usable.length === 0) return null;

  const series: ChartSeries[] = [
    { key: "revenue", label: "Revenue", color: "var(--chart-1)" },
    { key: "freeCashFlow", label: "Free cash flow", color: "var(--chart-3)" },
  ];

  return {
    title: "Annual growth rate (YoY)",
    description:
      "Year-over-year change in full-year totals. Strips out quarterly noise and seasonality so the multi-year trend is visible — not just the last 12 months.",
    kind: "bar",
    valueKind: "percent",
    series,
    points: usable,
  };
}

function buildBalanceSheet(input: SimpleAnalysisInputs): BalanceSheetEntry[] {
  // We re-derive the same profitability / debt / share-count helpers that
  // buildSimpleAnalysisEvidence uses, but at the evidence-building layer so
  // the BalanceSheetStrip is self-contained and easy to test in isolation.
  const profitability = describeProfitability({
    profitMargin: input.profitMargin,
    operatingMargin: input.operatingMargin,
    grossMargin: input.grossMargin,
    returnOnEquity: input.returnOnEquity,
    returnOnAssets: input.returnOnAssets,
    earningsGrowth: input.earningsGrowth,
  });
  const debtLoad = describeDebtLoad(input.totalDebt, input.totalCash);
  const debtService = describeDebtService({
    totalDebt: input.totalDebt,
    ebitda: input.ebitda,
    operatingCashflow: input.operatingCashflow,
    freeCashflow: input.freeCashflow,
    currentRatio: input.currentRatio,
    quickRatio: input.quickRatio,
  });
  const shareholderTrend = describeShareholderTrend(input.shareCountHistory);

  const cashReturn =
    input.freeCashflow != null && input.marketCap != null && input.marketCap > 0
      ? (input.freeCashflow / input.marketCap) * 100
      : null;
  const richPe = (input.peRatio ?? Infinity) > 25;
  const cheapPe = (input.forwardPE ?? input.peRatio ?? Infinity) < 15;

  return [
    {
      key: "profitability",
      label: "Profitability",
      value: profitability.value,
      description:
        "Operating margin (and the wider return profile) tells you how efficiently each dollar of sales becomes profit. High and rising = pricing power; low or falling = the business is grinding.",
      trend:
        profitability.view === "strong"
          ? "up"
          : profitability.view === "weak"
            ? "down"
            : profitability.view === "unknown"
              ? "mixed"
              : "flat",
      tone: profitability.tone,
    },
    {
      key: "shareCount",
      label: "Share count",
      value: shareholderTrend.value,
      description:
        "Are the buybacks outrunning the stock-based comp? A shrinking share count means every existing share owns a bigger slice of future earnings.",
      trend:
        shareholderTrend.view === "friendly"
          ? "up"
          : shareholderTrend.view === "diluting"
            ? "down"
            : shareholderTrend.view === "unknown"
              ? "mixed"
              : "flat",
      tone: shareholderTrend.tone,
    },
    {
      key: "debtLoad",
      label: "Debt load",
      value: debtLoad.value,
      description:
        "Total debt against cash and earnings power (EBITDA). Light debt leaves room to invest and weather downturns; heavy debt shrinks the margin for error.",
      trend: debtLoad.tone === "bad" ? "down" : debtLoad.tone === "good" ? "up" : "flat",
      tone: debtLoad.tone,
    },
    {
      key: "debtService",
      label: "Debt service",
      value: debtService.value,
      description:
        "Whether the cash the business generates easily covers its interest and loan payments. Strong here = no forced selling in a bad year.",
      trend:
        debtService.view === "strong"
          ? "up"
          : debtService.view === "weak"
            ? "down"
            : debtService.view === "unknown"
              ? "mixed"
              : "flat",
      tone: debtService.tone,
    },
    {
      key: "cashReturn",
      label: "Cash return at today's price",
      value: percentLabel(cashReturn),
      description:
        "Free cash flow divided by market cap — the cash yield you're getting for the price you pay. Above ~6% is rich, below ~3% is thin. P/E shown when the yield is too small to be useful.",
      trend:
        cashReturn == null
          ? richPe
            ? "down"
            : cheapPe
              ? "up"
              : "mixed"
          : cashReturn >= 6
            ? "up"
            : cashReturn < 3
              ? "down"
              : "flat",
      tone:
        cashReturn == null
          ? richPe
            ? "bad"
            : cheapPe
              ? "good"
              : "neutral"
          : cashReturn >= 6
            ? "good"
            : cashReturn < 3
              ? "bad"
              : "caution",
    },
  ];
}

function buildCagrTable(input: SimpleAnalysisInputs): SimpleAnalysisEvidence["cagrTable"] {
  const horizons: Array<{ label: string; years: number }> = [
    { label: "3 yr", years: 3 },
    { label: "2 yr", years: 2 },
    { label: "1 yr", years: 1 },
  ];
  const rows: SimpleAnalysisCagrRow[] = [];
  for (const metric of pickKpiMetrics(input)) {
    const cleaned = cleanHistory(metric.history);
    if (cleaned.length < 2) continue;
    const cells = horizons.map((h) => {
      const w = horizonCagr(cleaned, h.years);
      return {
        horizonLabel: h.label,
        years: h.years,
        cagr: w?.cagr == null ? null : `${w.cagr >= 0 ? "+" : ""}${w.cagr.toFixed(1)}%`,
        startValue: w ? compactCurrency(w.start) : null,
        endValue: w ? compactCurrency(w.end) : null,
        startLabel: w ? w.startLabel : null,
        endLabel: w ? w.endLabel : null,
      };
    });
    rows.push({
      metric: metric.key,
      metricLabel: metric.label,
      cells,
    });
  }
  return rows.length ? { horizons, rows } : null;
}
