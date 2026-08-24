import type { StockAnalysis } from "./schema";
import { parseStockThesis, buildStockThesis } from "./stock-thesis";
import { parseMacroThesis } from "./simple-analysis";
import { getLongTermRecommendation, getWeeklyRecommendationDisplay } from "./recommendation-labels";
import { formatUtcDate, formatUtcDateTime } from "./date-format";

export type ParsedRecommendation = {
  weeklyCall?: "BUY" | "SELL" | "WAIT";
  weeklyOutlook?: string;
  reasoning?: string;
  riskLevel?: string;
  priceTarget?: number | null;
  stopLoss?: number | null;
  keyBullishFactors?: string[];
  keyBearishFactors?: string[];
  weeklyTrend?: "uptrend" | "downtrend" | "sideways";
  pullbackTo21EMA?: boolean;
  consolidationBreakout21EMA?: boolean;
};

export function parseRecommendation(value: string | null | undefined): ParsedRecommendation | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ParsedRecommendation;
  } catch {
    return null;
  }
}

export function moneyStr(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: v >= 100 ? 0 : 2,
  }).format(v);
}

export function dateStr(v: string | Date | null | undefined, withTime = false) {
  return withTime ? formatUtcDateTime(v) : formatUtcDate(v);
}

export function analysisDateStr(v: string | null | undefined) {
  return formatUtcDate(v);
}

export function confidenceTone(confidence: number | null | undefined) {
  if (confidence == null) return "bg-muted";
  if (confidence >= 75) return "bg-emerald-500";
  if (confidence >= 55) return "bg-amber-400";
  return "bg-red-400";
}

export function confidenceLabel(confidence: number | null | undefined) {
  if (confidence == null) return "Unknown";
  if (confidence >= 75) return "High";
  if (confidence >= 55) return "Medium";
  return "Low";
}

export type StockPageDerived = {
  recommendation: ParsedRecommendation | null;
  weeklyRecommendation: ReturnType<typeof getWeeklyRecommendationDisplay>;
  persistedThesis: ReturnType<typeof parseStockThesis>;
  persistedMacroThesis: ReturnType<typeof parseMacroThesis>;
  derivedThesis: ReturnType<typeof buildStockThesis> | null;
  effectiveThesis: NonNullable<ReturnType<typeof parseStockThesis>> | null;
  longTermRecommendation: ReturnType<typeof getLongTermRecommendation>;
  macroThesisSpec: null;
};

export function deriveStockPageState(
  latestAnalysis: StockAnalysis | null,
  simpleAnalysisEvidence: import("./simple-analysis").SimpleAnalysisEvidence | null | undefined,
): StockPageDerived {
  const recommendation = parseRecommendation(latestAnalysis?.reasoning);
  const weeklyRecommendation = getWeeklyRecommendationDisplay(
    latestAnalysis?.reasoning ?? null,
    latestAnalysis?.signal ?? null,
    latestAnalysis?.confidence ?? null,
  );
  const persistedThesis = parseStockThesis(latestAnalysis?.thesisJson ?? null);
  const persistedMacroThesis = parseMacroThesis(latestAnalysis?.macroThesisJson ?? null);
  const derivedThesis =
    !persistedThesis &&
    simpleAnalysisEvidence &&
    latestAnalysis &&
    (latestAnalysis.signal === "BUY" || latestAnalysis.signal === "SELL")
      ? buildStockThesis(
          {
            signal: latestAnalysis.signal,
            weeklyCall: recommendation?.weeklyCall ?? null,
            cycle: latestAnalysis.cycle ?? null,
            cycleTimeframe:
              (latestAnalysis.cycleTimeframe as "SHORT" | "MEDIUM" | "LONG" | null) ?? null,
            confidence: latestAnalysis.confidence ?? null,
            riskLevel:
              (recommendation?.riskLevel as "LOW" | "MEDIUM" | "HIGH" | undefined) ?? undefined,
            weeklyTrend:
              (recommendation?.weeklyTrend as "uptrend" | "downtrend" | "sideways" | undefined) ??
              undefined,
            pullbackTo21EMA: recommendation?.pullbackTo21EMA,
            consolidationBreakout21EMA: recommendation?.consolidationBreakout21EMA,
            weeklyOutlook: recommendation?.weeklyOutlook,
            reasoning: recommendation?.reasoning,
            keyBullishFactors: recommendation?.keyBullishFactors,
            keyBearishFactors: recommendation?.keyBearishFactors,
          },
          simpleAnalysisEvidence,
          { hasExtremeRisk: false, macroThesis: persistedMacroThesis },
        )
      : null;
  const effectiveThesis = persistedThesis ?? derivedThesis;
  const longTermRecommendation = getLongTermRecommendation(effectiveThesis, persistedMacroThesis);

  return {
    recommendation,
    weeklyRecommendation,
    persistedThesis,
    persistedMacroThesis,
    derivedThesis,
    effectiveThesis,
    longTermRecommendation,
    macroThesisSpec: null,
  };
}
