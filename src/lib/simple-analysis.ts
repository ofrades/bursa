export type EvidenceTone = "good" | "caution" | "bad" | "neutral";
export type TrendDirection = "up" | "down" | "flat" | "mixed";
export type EvidenceStatus = "good" | "watch" | "avoid";
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

export type SimpleAnalysisEvidence = {
  headline: string;
  summary: string;
  status: EvidenceStatus;
  stats: SimpleAnalysisStat[];
  charts: SimpleAnalysisChart[];
  takeaways: string[];
};

export type SimpleAnalysisInputs = {
  symbol: string;
  salesHistory: HistoryPoint[];
  cashHistory: HistoryPoint[];
  priceHistory: HistoryPoint[];
  currentPrice: number | null;
  marketCap: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  freeCashflow: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
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

export function buildSimpleAnalysisEvidence(
  input: SimpleAnalysisInputs,
): SimpleAnalysisEvidence | null {
  const salesHistory = cleanHistory(input.salesHistory).slice(-5);
  const cashHistory = cleanHistory(input.cashHistory).slice(-5);
  const priceHistory = cleanHistory(input.priceHistory).slice(-5);

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
  const cashReturnAtPrice =
    input.freeCashflow != null && input.marketCap != null && input.marketCap > 0
      ? (input.freeCashflow / input.marketCap) * 100
      : null;

  const priceVsBusinessLabel =
    priceGap == null
      ? "hard to tell"
      : priceGap > 25
        ? "ahead"
        : priceGap < -15
          ? "behind"
          : "in step";

  const businessStrong =
    salesTrend === "up" && (cashTrend === "up" || (latestCash != null && latestCash > 0));
  const priceRich =
    (cashReturnAtPrice != null && cashReturnAtPrice < 3) ||
    (priceGap != null && priceGap > 25 && cashTrend !== "up");
  const safetyWeak = debtLoad.tone === "bad";

  const status: EvidenceStatus =
    businessStrong && !priceRich && !safetyWeak
      ? "good"
      : !businessStrong && (priceRich || safetyWeak)
        ? "avoid"
        : "watch";

  const headline =
    status === "good"
      ? "Business is improving and the price still looks grounded."
      : status === "avoid"
        ? "The price is asking for more than the business is giving."
        : "Some pieces look healthy, but the full picture is mixed.";

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
      label: "Debt load",
      value: debtLoad.value,
      detail: debtLoad.detail,
      trend: debtLoad.tone === "bad" ? "down" : debtLoad.tone === "good" ? "up" : "flat",
      tone: debtLoad.tone,
    },
    {
      label: "Cash return at today's price",
      value: percentLabel(cashReturnAtPrice),
      detail:
        cashReturnAtPrice == null
          ? "Could not compare price to cash."
          : cashReturnAtPrice >= 6
            ? "Strong cash return for the price paid today."
            : cashReturnAtPrice >= 3
              ? "Okay, but not especially cheap."
              : "Thin cash return for the price paid today.",
      trend:
        cashReturnAtPrice == null
          ? "mixed"
          : cashReturnAtPrice >= 6
            ? "up"
            : cashReturnAtPrice < 3
              ? "down"
              : "flat",
      tone:
        cashReturnAtPrice == null
          ? "neutral"
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

  if (input.profitMargin != null) {
    takeaways.push(
      `The company keeps about ${(input.profitMargin * 100).toFixed(1)}% of each dollar of sales as profit.`,
    );
  }

  if (input.currentPrice != null && priceTrend !== "mixed") {
    takeaways.push(
      `Recent market trend is ${priceTrend === "up" ? "helping" : priceTrend === "down" ? "working against" : "mostly flat for"} buyers at around ${compactCurrency(input.currentPrice)}.`,
    );
  }

  return {
    headline,
    summary: `${businessPhrase}, ${pricePhrase}, and ${safetyPhrase}.`,
    status,
    stats,
    charts: [salesChart, cashChart, priceVsBusinessChart].filter(
      (chart): chart is SimpleAnalysisChart => chart != null,
    ),
    takeaways: takeaways.slice(0, 4),
  };
}
