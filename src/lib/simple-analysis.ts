export type EvidenceTone = "good" | "caution" | "bad" | "neutral";
export type TrendDirection = "up" | "down" | "flat" | "mixed";
export type ChartKind = "bar" | "line";
export type ValueKind = "currency" | "percent" | "ratio" | "index";

export type HistoryPoint = {
  label: string;
  date: string;
  value: number | null;
};

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
};

export type ChartPoint = {
  label: string;
  [key: string]: string | number | null;
};

export type SimpleAnalysisChart = {
  title: string;
  description?: string;
  kind: ChartKind;
  valueKind: ValueKind;
  series: ChartSeries[];
  points: ChartPoint[];
};

export type SimpleAnalysisStat = {
  label: string;
  value: string;
  detail?: string;
  trend: TrendDirection;
  tone: EvidenceTone;
};

export type FundamentalPosture = "supportive" | "mixed" | "strained";
export type FundamentalBusinessView = "strong" | "mixed" | "weak";
export type FundamentalValuationView = "attractive" | "fair" | "stretched" | "unclear";
export type FundamentalBalanceSheetView = "strong" | "manageable" | "weak" | "unknown";
export type FundamentalDebtServiceView = "strong" | "mixed" | "weak" | "unknown";
export type FundamentalProfitabilityView = "strong" | "mixed" | "weak" | "unknown";
export type FundamentalShareholderView = "friendly" | "stable" | "diluting" | "unknown";

export type SCurvePosition = "early_adopter" | "crossing_chasm" | "mainstream" | "mature";
export type MacroTimeHorizon = "2y" | "5y" | "10y+";
export type DemandScenarioCase = "bear" | "base" | "bull";

export type MacroDemandScenario = {
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

export function parseMacroThesis(value: unknown): MacroThesis | null {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as MacroThesis;
    return parsed && typeof parsed === "object" && typeof parsed.secularBet === "string"
      ? parsed
      : null;
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
  takeaways: string[];
};

export function parseSimpleAnalysisEvidence(value: unknown): SimpleAnalysisEvidence | null {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as SimpleAnalysisEvidence;
    return parsed && typeof parsed === "object" && typeof parsed.title === "string" ? parsed : null;
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
  };
}
