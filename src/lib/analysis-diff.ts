import { getLongTermRecommendation } from "./recommendation-labels";
import { parseStockThesis } from "./stock-thesis";
import { parseMacroThesis } from "./simple-analysis";

// Minimal shape we need from each history row
export type AnalysisRow = {
  signal: string;
  confidence: number | null;
  reasoning: string | null;
  thesisJson: string | null;
  macroThesisJson: string | null;
  priceAtAnalysis: number | null;
  cycle: string | null;
  analysisDate: string;
  updatedAt: Date | null;
};

type ParsedReasoning = {
  weeklyOutlook?: string;
  reasoning?: string;
  riskLevel?: string;
  keyBullishFactors?: string[];
  keyBearishFactors?: string[];
};

function parseReasoning(value: string | null): ParsedReasoning {
  if (!value) return {};
  try {
    return JSON.parse(value) as ParsedReasoning;
  } catch {
    return {};
  }
}

export type FactorDiff = { added: string[]; removed: string[] };

export type AnalysisDiff = {
  newerDate: string;
  olderDate: string;

  signal: { from: string; to: string; flipped: boolean };
  confidence: { from: number | null; to: number | null; delta: number | null };
  longTerm: { from: string | null; to: string | null; changed: boolean };
  cycle: { from: string | null; to: string | null; changed: boolean };
  risk: { from: string | null; to: string | null; changed: boolean };
  price: { from: number | null; to: number | null; pct: number | null };

  bullish: FactorDiff;
  bearish: FactorDiff;

  /** The newer analysis's own explanation of its call */
  outlook: string | null;
  reasoning: string | null;

  /** True when something material changed (signal, long-term, cycle, or ≥2 factor changes) */
  hasMaterialChange: boolean;
};

function setDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));
  return {
    added: b.filter((s) => !setA.has(s.toLowerCase())),
    removed: a.filter((s) => !setB.has(s.toLowerCase())),
  };
}

export function buildAnalysisDiff(newer: AnalysisRow, older: AnalysisRow): AnalysisDiff {
  const newerR = parseReasoning(newer.reasoning);
  const olderR = parseReasoning(older.reasoning);

  const newerThesis = parseStockThesis(newer.thesisJson ?? null);
  const olderThesis = parseStockThesis(older.thesisJson ?? null);
  const newerMacro = parseMacroThesis(newer.macroThesisJson ?? null);
  const olderMacro = parseMacroThesis(older.macroThesisJson ?? null);

  const newerLT = getLongTermRecommendation(newerThesis, newerMacro);
  const olderLT = getLongTermRecommendation(olderThesis, olderMacro);

  const signalFlipped = newer.signal !== older.signal;
  const ltChanged = newerLT?.value !== olderLT?.value;
  const cycleChanged = newer.cycle !== older.cycle;

  const bullishDiff = setDiff(olderR.keyBullishFactors ?? [], newerR.keyBullishFactors ?? []);
  const bearishDiff = setDiff(olderR.keyBearishFactors ?? [], newerR.keyBearishFactors ?? []);
  const factorChangeCount =
    bullishDiff.added.length +
    bullishDiff.removed.length +
    bearishDiff.added.length +
    bearishDiff.removed.length;

  const confidenceDelta =
    newer.confidence != null && older.confidence != null
      ? Math.round(newer.confidence - older.confidence)
      : null;

  const pricePct =
    newer.priceAtAnalysis && older.priceAtAnalysis
      ? ((newer.priceAtAnalysis - older.priceAtAnalysis) / older.priceAtAnalysis) * 100
      : null;

  return {
    newerDate: newer.analysisDate,
    olderDate: older.analysisDate,

    signal: { from: older.signal, to: newer.signal, flipped: signalFlipped },
    confidence: {
      from: older.confidence,
      to: newer.confidence,
      delta: confidenceDelta,
    },
    longTerm: {
      from: olderLT?.value ?? null,
      to: newerLT?.value ?? null,
      changed: ltChanged,
    },
    cycle: { from: older.cycle, to: newer.cycle, changed: cycleChanged },
    risk: {
      from: olderR.riskLevel ?? null,
      to: newerR.riskLevel ?? null,
      changed: olderR.riskLevel !== newerR.riskLevel,
    },
    price: {
      from: older.priceAtAnalysis,
      to: newer.priceAtAnalysis,
      pct: pricePct != null ? Math.round(pricePct * 10) / 10 : null,
    },

    bullish: bullishDiff,
    bearish: bearishDiff,

    outlook: newerR.weeklyOutlook ?? null,
    reasoning: newerR.reasoning ?? null,

    hasMaterialChange: signalFlipped || ltChanged || cycleChanged || factorChangeCount >= 2,
  };
}
