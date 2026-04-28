import { parseMacroThesis, type MacroThesis } from "./simple-analysis";
import { parseStockThesis, type StockThesis, type ThesisTone } from "./stock-thesis";

export type WeeklyRecommendationDisplay = {
  value: "BUY" | "SELL" | "WAIT" | "HOLD";
  confidence: number | null;
};

function parseSignalPayload(
  value: unknown,
): { weeklyCall?: string; signal?: string; confidence?: number } | null {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as {
      weeklyCall?: string;
      signal?: string;
      confidence?: number;
    };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeWeeklyCall(value: unknown): WeeklyRecommendationDisplay["value"] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "BUY" ||
    normalized === "SELL" ||
    normalized === "WAIT" ||
    normalized === "HOLD"
  ) {
    return normalized;
  }
  return null;
}

export function getWeeklyRecommendationDisplay(
  signalValue: unknown,
  fallbackSignal?: string | null,
  fallbackConfidence?: number | null,
): WeeklyRecommendationDisplay {
  const parsed = parseSignalPayload(signalValue);
  return {
    value:
      normalizeWeeklyCall(parsed?.weeklyCall) ??
      normalizeWeeklyCall(parsed?.signal) ??
      normalizeWeeklyCall(fallbackSignal) ??
      "HOLD",
    confidence:
      typeof parsed?.confidence === "number" ? parsed.confidence : (fallbackConfidence ?? null),
  };
}

export type LongTermRecommendation = {
  value: "Own" | "Maybe own" | "Avoid";
  label: string;
  tone: ThesisTone;
  summary: string;
  confidence: number | null;
};

export function getLongTermRecommendation(
  thesis: StockThesis | null,
  macroThesis?: MacroThesis | null,
): LongTermRecommendation | null {
  if (!thesis) return null;

  const confidence = macroThesis?.confidence ?? null;

  if (thesis.ownability.value === "Own") {
    return {
      value: "Own",
      label: "Long-term own",
      tone: "supportive",
      summary: thesis.ownability.summary,
      confidence,
    };
  }

  if (thesis.ownability.value === "Avoid") {
    return {
      value: "Avoid",
      label: "Long-term avoid",
      tone: "cautious",
      summary: thesis.ownability.summary,
      confidence,
    };
  }

  return {
    value: "Maybe own",
    label: "Long-term watch",
    tone: "balanced",
    summary: thesis.ownability.summary,
    confidence,
  };
}

export function getLongTermRecommendationFromJson(
  thesisValue: unknown,
  macroThesisValue?: unknown,
) {
  return getLongTermRecommendation(
    parseStockThesis(thesisValue),
    parseMacroThesis(macroThesisValue),
  );
}
