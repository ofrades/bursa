import type { FundamentalSeriesPoint } from "../market-data";
import type { Statements } from "./compute";

type Trend = {
  period?: string | null;
  endDate?: string | null;
  epsTrend?: {
    current?: number | null;
    "90daysAgo"?: number | null;
    epsTrendCurrency?: string | null;
  } | null;
  earningsEstimate?: { avg?: number | null; yearAgoEps?: number | null } | null;
  growth?: number | null;
  epsRevisions?: { upLast30days?: number | null; downLast30days?: number | null } | null;
};

export function readRevision(entry: Trend | undefined) {
  const current = entry?.epsTrend?.current ?? null;
  const previous = entry?.epsTrend?.["90daysAgo"] ?? null;
  // Percentage changes through zero are not comparable with profitable companies.
  const revision =
    current !== null && previous !== null && current > 0 && previous > 0
      ? current / previous - 1
      : null;
  const avg = entry?.earningsEstimate?.avg ?? null;
  const yearAgo = entry?.earningsEstimate?.yearAgoEps ?? null;
  return {
    current,
    previous,
    targetDate: entry?.endDate ?? null,
    currency: entry?.epsTrend?.epsTrendCurrency ?? null,
    revision,
    epsGrowth: avg !== null && yearAgo !== null && yearAgo > 0 ? avg / yearAgo - 1 : null,
    up30: entry?.epsRevisions?.upLast30days ?? null,
    down30: entry?.epsRevisions?.downLast30days ?? null,
  };
}

export function readStatements(series: Record<string, FundamentalSeriesPoint[]>) {
  const dates = (series.annualTotalAssets ?? [])
    .filter((p) => p.value !== null && p.date !== "")
    .map((p) => p.date)
    .sort()
    .reverse();
  const [date, priorDate] = [...new Set(dates)];
  const at = (type: string, when: string | undefined) =>
    when ? (series[type]?.find((p) => p.date === when)?.value ?? null) : null;
  const latest = (type: string) => at(type, date);
  const two = (type: string): [number | null, number | null] => [
    at(type, date),
    at(type, priorDate),
  ];
  const shares = (when: string | undefined) =>
    at("annualOrdinarySharesNumber", when) ?? at("annualShareIssued", when);
  const ltd = latest("annualLongTermDebt");
  const currentDebt = latest("annualCurrentDebt");
  const statements: Statements = {
    ebit: latest("annualEBIT"),
    depreciation:
      latest("annualReconciledDepreciation") ?? latest("annualDepreciationAmortizationDepletion"),
    pretaxIncome: latest("annualPretaxIncome"),
    taxProvision: latest("annualTaxProvision"),
    netIncome: two("annualNetIncome"),
    totalRevenue: two("annualTotalRevenue"),
    grossProfit: two("annualGrossProfit"),
    totalAssets: two("annualTotalAssets"),
    currentAssets: two("annualCurrentAssets"),
    currentLiabilities: two("annualCurrentLiabilities"),
    totalDebt:
      latest("annualTotalDebt") ??
      (ltd !== null && currentDebt !== null ? ltd + currentDebt : null),
    longTermDebt: two("annualLongTermDebt"),
    stockholdersEquity: latest("annualStockholdersEquity"),
    cash: latest("annualCashAndCashEquivalents"),
    shortTermInvestments: latest("annualOtherShortTermInvestments"),
    sharesOutstanding: [shares(date), shares(priorDate)],
    operatingCashFlow: latest("annualOperatingCashFlow"),
    capitalExpenditure: latest("annualCapitalExpenditure"),
  };
  return { statements, date: date ?? null, priorDate: priorDate ?? null };
}
