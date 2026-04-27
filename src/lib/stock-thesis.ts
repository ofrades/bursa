import type { FundamentalPosture, SimpleAnalysisEvidence, MacroThesis } from "./simple-analysis";

export type WeeklyTrend = "uptrend" | "downtrend" | "sideways";
export type CycleTimeframe = "SHORT" | "MEDIUM" | "LONG";
export type WeeklySignal = "BUY" | "SELL";
export type WeeklyRiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type ThesisTone = "supportive" | "balanced" | "cautious";

export type WeeklyRecommendationContext = {
  signal: WeeklySignal;
  cycle: string | null;
  cycleTimeframe: CycleTimeframe | null;
  confidence: number | null;
  riskLevel?: WeeklyRiskLevel;
  weeklyTrend?: WeeklyTrend;
  pullbackTo21EMA?: boolean;
  consolidationBreakout21EMA?: boolean;
  weeklyOutlook?: string;
  reasoning?: string;
  keyBullishFactors?: string[];
  keyBearishFactors?: string[];
  relativeStrengthVsMarket20d?: number | null;
  relativeStrengthVsSector20d?: number | null;
  daysToEarnings?: number | null;
  earningsEventRisk?: string | null;
  earningsEstimateDelta30dPct?: number | null;
  earningsEstimateDelta90dPct?: number | null;
  revisionBalance30d?: number | null;
};

export type ThesisPillar = {
  title: string;
  value: string;
  tone: ThesisTone;
  summary: string;
};

export const STOCK_THESIS_VERSION = "v1";

export type StockThesis = {
  version: string;
  title: string;
  summary: string;
  tone: ThesisTone;
  confidence: {
    base: number | null;
    adjusted: number | null;
    delta: number;
  };
  ownability: ThesisPillar;
  actionability: ThesisPillar;
  survivability: ThesisPillar;
  alignment: ThesisPillar;
  support: string[];
  limits: string[];
};

export type StockThesisChange = {
  field: "ownability" | "actionability" | "survivability" | "alignment" | "conviction";
  label: string;
  from: string;
  to: string;
};

export type StockThesisChangeTone = "positive" | "negative" | "neutral";

export function parseStockThesis(value: unknown): StockThesis | null {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as StockThesis;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function fieldRank(field: StockThesisChange["field"], value: string): number | null {
  if (field === "ownability") {
    return { Avoid: 0, "Maybe own": 1, Own: 2 }[value] ?? null;
  }
  if (field === "actionability") {
    return { "Trim / avoid": 0, Wait: 1, "Add now": 2 }[value] ?? null;
  }
  if (field === "survivability") {
    return { Fragile: 0, Watch: 1, Safe: 2 }[value] ?? null;
  }
  if (field === "alignment") {
    return { "Timing-only": 0, Tactical: 0, Mixed: 1, Aligned: 2 }[value] ?? null;
  }
  if (field === "conviction") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function stockThesisChangeTone(change: StockThesisChange): StockThesisChangeTone {
  const fromRank = fieldRank(change.field, change.from);
  const toRank = fieldRank(change.field, change.to);
  if (fromRank == null || toRank == null || fromRank === toRank) return "neutral";
  return toRank > fromRank ? "positive" : "negative";
}

export function stockThesisChangesTone(changes: StockThesisChange[]): StockThesisChangeTone {
  const tones = changes.map(stockThesisChangeTone);
  const hasPositive = tones.includes("positive");
  const hasNegative = tones.includes("negative");
  if (hasPositive && !hasNegative) return "positive";
  if (hasNegative && !hasPositive) return "negative";
  return "neutral";
}

export function diffStockThesis(
  current: StockThesis | null,
  previous: StockThesis | null,
): StockThesisChange[] {
  if (!current || !previous) return [];

  const changes: StockThesisChange[] = [];
  const comparePillar = (
    field: "ownability" | "actionability" | "survivability" | "alignment",
    label: string,
  ) => {
    const now = current[field].value;
    const before = previous[field].value;
    if (now !== before) {
      changes.push({ field, label, from: before, to: now });
    }
  };

  comparePillar("ownability", "Long-term exposure");
  comparePillar("actionability", "Entry window");
  comparePillar("survivability", "Risk check");
  comparePillar("alignment", "Alignment");

  const currentConfidence = current.confidence.adjusted ?? current.confidence.base;
  const previousConfidence = previous.confidence.adjusted ?? previous.confidence.base;
  if (
    currentConfidence != null &&
    previousConfidence != null &&
    Math.abs(currentConfidence - previousConfidence) >= 5
  ) {
    changes.push({
      field: "conviction",
      label: "Conviction",
      from: `${Math.round(previousConfidence)}%`,
      to: `${Math.round(currentConfidence)}%`,
    });
  }

  return changes;
}

function dedupe(items: Array<string | null | undefined>) {
  return Array.from(
    new Set(items.map((item) => item?.trim()).filter((item): item is string => Boolean(item))),
  );
}

function postureTone(posture: FundamentalPosture): ThesisTone {
  switch (posture) {
    case "supportive":
      return "supportive";
    case "strained":
      return "cautious";
    default:
      return "balanced";
  }
}

function ownabilityFromEvidence(evidence: SimpleAnalysisEvidence): ThesisPillar {
  if (
    evidence.posture === "supportive" &&
    evidence.debtServiceView !== "weak" &&
    evidence.profitabilityView !== "weak" &&
    evidence.shareholderView !== "diluting"
  ) {
    return {
      title: "Long-term exposure",
      value: "Own",
      tone: "supportive",
      summary: "The business backdrop is strong enough for long-term exposure.",
    };
  }

  if (
    evidence.posture === "strained" ||
    evidence.debtServiceView === "weak" ||
    (evidence.profitabilityView === "weak" && evidence.balanceSheetView === "weak")
  ) {
    return {
      title: "Long-term exposure",
      value: "Avoid",
      tone: "cautious",
      summary: "The business or valuation backdrop is not ready for long-term conviction.",
    };
  }

  return {
    title: "Long-term exposure",
    value: "Maybe own",
    tone: "balanced",
    summary: "There is a case here, but one sleeve still needs work.",
  };
}

function confidenceAdjustment(
  weekly: WeeklyRecommendationContext,
  evidence: SimpleAnalysisEvidence,
  hasExtremeRisk: boolean,
  macroThesis?: MacroThesis | null,
) {
  if (weekly.confidence == null) {
    return { adjusted: null, delta: 0 };
  }

  let delta = 0;

  if (weekly.signal === "BUY" && evidence.posture === "strained") delta -= 18;
  if (weekly.signal === "SELL" && evidence.posture === "supportive") delta -= 12;
  if (weekly.signal === "BUY" && evidence.posture === "supportive") delta += 4;
  if (weekly.signal === "SELL" && evidence.posture === "strained") delta += 4;

  if (weekly.riskLevel === "HIGH") delta -= 10;
  if (weekly.riskLevel === "LOW") delta += 2;

  if (evidence.balanceSheetView === "weak") delta -= 8;
  if (evidence.balanceSheetView === "strong") delta += 2;
  if (evidence.debtServiceView === "weak") delta -= 8;
  if (evidence.debtServiceView === "strong") delta += 2;

  if (weekly.signal === "BUY" && evidence.valuationView === "stretched") delta -= 8;
  if (weekly.signal === "BUY" && evidence.valuationView === "attractive") delta += 3;

  if (evidence.profitabilityView === "strong") delta += 4;
  if (evidence.profitabilityView === "weak") delta -= 8;
  if (evidence.shareholderView === "friendly") delta += 2;
  if (evidence.shareholderView === "diluting") delta -= 5;

  if (weekly.relativeStrengthVsMarket20d != null) {
    if (weekly.relativeStrengthVsMarket20d >= 6) delta += 4;
    else if (weekly.relativeStrengthVsMarket20d <= -6) delta -= 6;
  }

  if (weekly.relativeStrengthVsSector20d != null) {
    if (weekly.relativeStrengthVsSector20d >= 4) delta += 3;
    else if (weekly.relativeStrengthVsSector20d <= -4) delta -= 4;
  }

  if (weekly.earningsEstimateDelta30dPct != null) {
    if (weekly.earningsEstimateDelta30dPct >= 5) delta += 3;
    else if (weekly.earningsEstimateDelta30dPct <= -5) delta -= 5;
  }

  if (weekly.revisionBalance30d != null) {
    if (weekly.revisionBalance30d >= 2) delta += 2;
    else if (weekly.revisionBalance30d <= -2) delta -= 3;
  }

  if (weekly.earningsEventRisk === "imminent") delta -= 8;
  else if (weekly.earningsEventRisk === "near") delta -= 3;

  if (hasExtremeRisk) delta -= 12;

  // Macro opportunity thesis delta
  if (macroThesis != null) {
    const score = macroThesis.opportunityScore;
    if (score >= 70 && weekly.signal === "BUY") delta += 6;
    if (score >= 70 && weekly.signal === "SELL") delta -= 4;
    if (score <= 30 && weekly.signal === "BUY") delta -= 8;
    if (score <= 30 && weekly.signal === "SELL") delta += 3;
  }

  const adjusted = clamp(Math.round(weekly.confidence + delta), 5, 95);
  return {
    adjusted,
    delta: adjusted - weekly.confidence,
  };
}

function actionabilityFromWeekly(
  weekly: WeeklyRecommendationContext,
  adjustedConfidence: number | null,
): ThesisPillar {
  const setupReady =
    weekly.weeklyTrend === "uptrend" ||
    weekly.pullbackTo21EMA === true ||
    weekly.consolidationBreakout21EMA === true;
  const confidence = adjustedConfidence ?? weekly.confidence ?? 0;
  const laggingMarket = (weekly.relativeStrengthVsMarket20d ?? 0) <= -4;
  const laggingSector = (weekly.relativeStrengthVsSector20d ?? 0) <= -3;
  const imminentEarnings = weekly.earningsEventRisk === "imminent";
  const weakRevisions =
    (weekly.earningsEstimateDelta30dPct ?? 0) <= -5 || (weekly.revisionBalance30d ?? 0) <= -2;

  if (weekly.signal === "BUY") {
    if (setupReady && confidence >= 55 && !laggingMarket && !imminentEarnings) {
      return {
        title: "Entry window",
        value: "Add now",
        tone: "supportive",
        summary: "The setup still offers a usable entry in this window.",
      };
    }

    return {
      title: "Entry window",
      value: "Wait",
      tone: "balanced",
      summary: imminentEarnings
        ? "An earnings event is too close to treat this as a clean entry window."
        : laggingMarket || laggingSector
          ? "The setup is fighting relative strength, so patience still matters."
          : weakRevisions
            ? "Estimate revisions are soft enough to keep this in wait mode."
            : "The idea survives, but the entry is not clean enough yet.",
    };
  }

  if (weekly.weeklyTrend === "downtrend" || confidence >= 60) {
    return {
      title: "Entry window",
      value: "Trim / avoid",
      tone: "cautious",
      summary: "Near-term price action is defensive right now.",
    };
  }

  return {
    title: "Entry window",
    value: "Wait",
    tone: "balanced",
    summary: "The tape is not strong enough to press, but not broken enough to force a move.",
  };
}

function survivabilityFromRisk(
  weekly: WeeklyRecommendationContext,
  evidence: SimpleAnalysisEvidence,
  hasExtremeRisk: boolean,
): ThesisPillar {
  if (
    hasExtremeRisk ||
    weekly.riskLevel === "HIGH" ||
    weekly.earningsEventRisk === "imminent" ||
    evidence.balanceSheetView === "weak" ||
    evidence.debtServiceView === "weak" ||
    (evidence.profitabilityView === "weak" && evidence.posture !== "supportive")
  ) {
    return {
      title: "Risk check",
      value: "Fragile",
      tone: "cautious",
      summary: "The downside can widen quickly if this setup goes wrong.",
    };
  }

  if (
    weekly.riskLevel === "LOW" &&
    evidence.balanceSheetView === "strong" &&
    evidence.posture !== "strained"
  ) {
    return {
      title: "Risk check",
      value: "Safe",
      tone: "supportive",
      summary: "The balance sheet and current setup leave room to stay patient.",
    };
  }

  return {
    title: "Risk check",
    value: "Watch",
    tone: "balanced",
    summary: "Risk is manageable, but position size and timing still matter.",
  };
}

function alignmentFromPillars(
  weekly: WeeklyRecommendationContext,
  ownability: ThesisPillar,
  evidence: SimpleAnalysisEvidence,
): ThesisPillar {
  if (weekly.signal === "BUY" && ownability.value === "Own") {
    return {
      title: "Alignment",
      value: "Aligned",
      tone: "supportive",
      summary: "The weekly setup and the long-term case are pulling together.",
    };
  }

  if (weekly.signal === "SELL" && ownability.value === "Avoid") {
    return {
      title: "Alignment",
      value: "Aligned",
      tone: "cautious",
      summary: "The weekly weakness matches a poor long-term backdrop.",
    };
  }

  if (weekly.signal === "BUY" && evidence.posture === "strained") {
    return {
      title: "Alignment",
      value: "Tactical",
      tone: "balanced",
      summary: "The setup is better than the business backdrop, so this is tactical.",
    };
  }

  if (weekly.signal === "SELL" && evidence.posture === "supportive") {
    return {
      title: "Alignment",
      value: "Timing-only",
      tone: "balanced",
      summary: "The business may still be sound, but this week is not the moment to press.",
    };
  }

  return {
    title: "Alignment",
    value: "Mixed",
    tone: postureTone(evidence.posture),
    summary: "Neither horizon fully wins, so size and patience matter.",
  };
}

function finalActionFromPillars(
  ownability: ThesisPillar,
  actionability: ThesisPillar,
  survivability: ThesisPillar,
  alignment: ThesisPillar,
): Pick<StockThesis, "title" | "summary" | "tone"> {
  if (
    ownability.value === "Own" &&
    actionability.value === "Add now" &&
    survivability.value === "Safe"
  ) {
    return {
      title: "Build long-term exposure",
      summary: "The business, timing, and risk backdrop are all working together.",
      tone: "supportive",
    };
  }

  if (ownability.value === "Own" && actionability.value === "Wait") {
    return {
      title: "Own it, but wait for a better window",
      summary: "The long-term case survives, but the entry does not need to happen right now.",
      tone: "balanced",
    };
  }

  if (ownability.value === "Own" && actionability.value === "Trim / avoid") {
    return {
      title: "Good business, weak entry window",
      summary: "The company can still be worth following, but the near-term setup is defensive.",
      tone: "balanced",
    };
  }

  if (ownability.value === "Maybe own" && actionability.value === "Add now") {
    return {
      title: "Treat it as tactical only",
      summary:
        "The setup is stronger than the long-term case, so keep the position thesis short and honest.",
      tone: "balanced",
    };
  }

  if (ownability.value === "Avoid" && actionability.value === "Add now") {
    return {
      title: "Do not confuse momentum with quality",
      summary: "There may be a trade here, but it is not a clean long-term hold.",
      tone: "cautious",
    };
  }

  if (survivability.value === "Fragile") {
    return {
      title: "Size small or stay away",
      summary: "The risk sleeve is too fragile to support aggressive exposure.",
      tone: "cautious",
    };
  }

  if (alignment.value === "Timing-only") {
    return {
      title: "Keep it on the list, not in a hurry",
      summary:
        "The business may still deserve attention, but this week is not offering the right tape.",
      tone: "balanced",
    };
  }

  return {
    title: "Keep it on watch",
    summary: "The case is not broken, but it is not clean enough to force a move.",
    tone: "balanced",
  };
}

function supportBullets(weekly: WeeklyRecommendationContext, evidence: SimpleAnalysisEvidence) {
  const items = [
    evidence.businessView === "strong" ? "Sales and cash still support a long hold." : null,
    evidence.valuationView === "attractive"
      ? "Price still looks reasonable against the business."
      : null,
    evidence.balanceSheetView === "strong"
      ? "Balance sheet gives the thesis room to breathe."
      : null,
    evidence.debtServiceView === "strong"
      ? "Debt service still looks controlled against cash generation."
      : null,
    evidence.profitabilityView === "strong"
      ? "Margins and returns still support the long hold."
      : null,
    evidence.shareholderView === "friendly"
      ? "Share count has been shrinking instead of diluting holders."
      : null,
    weekly.relativeStrengthVsMarket20d != null && weekly.relativeStrengthVsMarket20d >= 4
      ? `The stock is leading the broad market by ${weekly.relativeStrengthVsMarket20d.toFixed(1)} points over the past month.`
      : null,
    weekly.relativeStrengthVsSector20d != null && weekly.relativeStrengthVsSector20d >= 3
      ? `The stock is also leading its sector by ${weekly.relativeStrengthVsSector20d.toFixed(1)} points.`
      : null,
    weekly.signal === "BUY" && weekly.consolidationBreakout21EMA
      ? "The setup still has breakout energy behind it."
      : null,
    weekly.signal === "BUY" && weekly.pullbackTo21EMA
      ? "The setup is leaning on a pullback entry near support."
      : null,
    weekly.signal === "BUY" && weekly.weeklyTrend === "uptrend"
      ? "Trend is still doing some of the heavy lifting this week."
      : null,
    weekly.earningsEstimateDelta30dPct != null && weekly.earningsEstimateDelta30dPct >= 5
      ? `Earnings estimates have improved ${weekly.earningsEstimateDelta30dPct.toFixed(1)}% over the past month.`
      : null,
    weekly.revisionBalance30d != null && weekly.revisionBalance30d >= 2
      ? `Analyst revisions have been net positive over the past month.`
      : null,
    weekly.keyBullishFactors?.[0] ?? null,
  ];

  return dedupe(items).slice(0, 4);
}

function limitBullets(
  weekly: WeeklyRecommendationContext,
  evidence: SimpleAnalysisEvidence,
  ownability: ThesisPillar,
  survivability: ThesisPillar,
  alignment: ThesisPillar,
) {
  const items = [
    alignment.value === "Tactical"
      ? "Treat the bullish read as tactical, not as a long-hold signal."
      : null,
    alignment.value === "Timing-only" ? "This is a timing fade, not a broken-company call." : null,
    survivability.value === "Fragile" ? "This needs smaller size or more patience." : null,
    evidence.balanceSheetView === "weak" ? "Balance sheet is carrying real pressure." : null,
    evidence.debtServiceView === "weak"
      ? "Debt service looks stretched for current cash generation."
      : null,
    evidence.valuationView === "stretched" ? "Price already asks a lot from the business." : null,
    evidence.businessView === "weak" ? "Business trend still needs more proof." : null,
    evidence.profitabilityView === "weak"
      ? "Margins or returns are too soft for a clean long hold."
      : null,
    evidence.shareholderView === "diluting"
      ? "Share count has been rising, which can cap per-share gains."
      : null,
    ownability.value === "Maybe own" ? "One sleeve still needs more evidence." : null,
    weekly.relativeStrengthVsMarket20d != null && weekly.relativeStrengthVsMarket20d <= -4
      ? `The stock is lagging the broad market by ${Math.abs(weekly.relativeStrengthVsMarket20d).toFixed(1)} points over the past month.`
      : null,
    weekly.relativeStrengthVsSector20d != null && weekly.relativeStrengthVsSector20d <= -3
      ? `The stock is trailing its sector by ${Math.abs(weekly.relativeStrengthVsSector20d).toFixed(1)} points.`
      : null,
    weekly.earningsEventRisk === "imminent"
      ? `An earnings event is within the next week, so short-term gap risk is elevated.`
      : null,
    weekly.earningsEstimateDelta30dPct != null && weekly.earningsEstimateDelta30dPct <= -5
      ? `Earnings estimates have been cut ${Math.abs(weekly.earningsEstimateDelta30dPct).toFixed(1)}% over the past month.`
      : null,
    weekly.revisionBalance30d != null && weekly.revisionBalance30d <= -2
      ? `Analyst revisions have been net negative over the past month.`
      : null,
    weekly.keyBearishFactors?.[0] ?? null,
  ];

  return dedupe(items).slice(0, 4);
}

export function buildStockThesis(
  weekly: WeeklyRecommendationContext,
  evidence: SimpleAnalysisEvidence | null,
  options?: { hasExtremeRisk?: boolean; macroThesis?: MacroThesis | null },
): StockThesis | null {
  if (!evidence) return null;

  const hasExtremeRisk = options?.hasExtremeRisk === true;
  const macroThesis = options?.macroThesis ?? null;
  const ownability = ownabilityFromEvidence(evidence);
  const confidence = confidenceAdjustment(weekly, evidence, hasExtremeRisk, macroThesis);
  const actionability = actionabilityFromWeekly(weekly, confidence.adjusted);
  const survivability = survivabilityFromRisk(weekly, evidence, hasExtremeRisk);
  const alignment = alignmentFromPillars(weekly, ownability, evidence);
  const headline = finalActionFromPillars(ownability, actionability, survivability, alignment);

  return {
    version: STOCK_THESIS_VERSION,
    ...headline,
    confidence: {
      base: weekly.confidence,
      adjusted: confidence.adjusted,
      delta: confidence.delta,
    },
    ownability,
    actionability,
    survivability,
    alignment,
    support: supportBullets(weekly, evidence),
    limits: limitBullets(weekly, evidence, ownability, survivability, alignment),
  };
}
