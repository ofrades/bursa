import { z } from "zod";

import { normalizeScore } from "./analysis-normalize";
import { parseMacroThesis, type MacroThesis } from "./simple-analysis";
import { parseStockThesis, type StockThesis, type ThesisTone } from "./stock-thesis";

export type WeeklyRecommendationDisplay = {
  value: "BUY" | "SELL" | "WAIT" | "HOLD";
  confidence: number | null;
};

type SignalPayload = { weeklyCall?: string; signal?: string; confidence?: number };

function parseSignalPayload(value: string | null | undefined): SignalPayload | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const object = z.record(z.string(), z.unknown()).safeParse(parsed);
    return object.success ? (parsed as SignalPayload) : null;
  } catch {
    return null;
  }
}

function normalizeWeeklyCall(
  value: string | null | undefined,
): WeeklyRecommendationDisplay["value"] | null {
  const normalized = value?.trim().toUpperCase();
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
  signalValue: string | null,
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
    confidence: normalizeScore(parsed?.confidence) ?? normalizeScore(fallbackConfidence) ?? null,
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

  const confidence = normalizeScore(macroThesis?.confidence) ?? null;

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
  thesisValue: string | null | undefined,
  macroThesisValue?: string | null,
) {
  return getLongTermRecommendation(
    parseStockThesis(thesisValue),
    parseMacroThesis(macroThesisValue),
  );
}
