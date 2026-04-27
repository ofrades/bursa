import type { FundamentalPosture, SimpleAnalysisEvidence } from "./simple-analysis";

export type WeeklyTrend = "uptrend" | "downtrend" | "sideways";
export type CycleTimeframe = "SHORT" | "MEDIUM" | "LONG";
export type WeeklySignal = "BUY" | "SELL";

export type WeeklyRecommendationContext = {
  signal: WeeklySignal;
  cycle: string | null;
  cycleTimeframe: CycleTimeframe | null;
  confidence: number | null;
  weeklyTrend?: WeeklyTrend;
  pullbackTo21EMA?: boolean;
  consolidationBreakout21EMA?: boolean;
};

export type ReconciliationTone = "supportive" | "balanced" | "cautious";

export type AnalysisReconciliation = {
  title: string;
  summary: string;
  tone: ReconciliationTone;
  bullets: string[];
};

function timeframeLabel(timeframe: CycleTimeframe | null | undefined) {
  switch (timeframe) {
    case "SHORT":
      return "short-term";
    case "LONG":
      return "longer-term";
    default:
      return "medium-term";
  }
}

function setupReason(weekly: WeeklyRecommendationContext) {
  if (weekly.signal === "BUY") {
    if (weekly.consolidationBreakout21EMA) {
      return "The weekly call leans on a breakout from consolidation near the 21 EMA, which is mainly a timing signal rather than a full business verdict.";
    }
    if (weekly.pullbackTo21EMA) {
      return "The weekly call leans on a pullback entry near the 21 EMA, which is mainly a timing setup rather than a claim that the whole business is suddenly better.";
    }
    if (weekly.weeklyTrend === "uptrend") {
      return "The weekly call leans on an intact uptrend, so the model is prioritizing market timing and participation in current momentum.";
    }
    return "The weekly call is leaning on shorter-horizon price action and setup quality more than on a broad long-term re-rating of the company.";
  }

  if (weekly.weeklyTrend === "downtrend") {
    return "The weekly SELL is mainly a risk-management call against a weakening trend, not automatically a claim that the business itself is broken.";
  }

  return "The weekly SELL is mainly a timing and risk-management call, so it can diverge from the longer business picture when the setup deteriorates.";
}

function postureLabel(posture: FundamentalPosture) {
  switch (posture) {
    case "supportive":
      return "supportive";
    case "strained":
      return "strained";
    default:
      return "mixed";
  }
}

function fundamentalsReason(evidence: SimpleAnalysisEvidence) {
  const parts: string[] = [];

  if (evidence.businessView === "strong") {
    parts.push("the business trend looks healthy");
  } else if (evidence.businessView === "weak") {
    parts.push("the business trend still looks weak");
  } else {
    parts.push("the business trend is mixed");
  }

  if (evidence.valuationView === "attractive") {
    parts.push("the price still looks reasonable against the business");
  } else if (evidence.valuationView === "stretched") {
    parts.push("the price already asks a lot relative to the business");
  }

  if (evidence.balanceSheetView === "strong") {
    parts.push("the balance sheet looks solid");
  } else if (evidence.balanceSheetView === "weak") {
    parts.push("the balance sheet adds real risk");
  }

  const sentence = parts.join(", ");
  return sentence ? `${sentence}.` : "The fundamental backdrop is mixed.";
}

export function reconcileWeeklyWithFundamentals(
  weekly: WeeklyRecommendationContext,
  evidence: SimpleAnalysisEvidence | null,
): AnalysisReconciliation | null {
  if (!evidence) return null;

  const tfLabel = timeframeLabel(weekly.cycleTimeframe);
  const posture = evidence.posture;
  const confidenceText =
    weekly.confidence != null ? ` Confidence is ${Math.round(weekly.confidence)}%.` : "";

  if (weekly.signal === "BUY" && posture === "supportive") {
    return {
      title: "This week's BUY is backed by the broader fundamentals.",
      summary: `The ${tfLabel} setup and the business backdrop are pointing in the same general direction.${confidenceText}`,
      tone: "supportive",
      bullets: [
        setupReason(weekly),
        `Fundamentals look ${postureLabel(posture)}: ${fundamentalsReason(evidence)}`,
        "That makes this read closer to a supported entry than a purely tactical trade.",
      ],
    };
  }

  if (weekly.signal === "SELL" && posture === "strained") {
    return {
      title: "This week's SELL lines up with a weak fundamental backdrop.",
      summary: `The ${tfLabel} setup is defensive, and the supporting business evidence is not giving much cushion.${confidenceText}`,
      tone: "cautious",
      bullets: [
        setupReason(weekly),
        `Fundamentals look ${postureLabel(posture)}: ${fundamentalsReason(evidence)}`,
        "That makes the weekly caution easier to justify as more than just a chart wobble.",
      ],
    };
  }

  if (weekly.signal === "BUY" && posture === "strained") {
    return {
      title: "This week's BUY is tactical, not a clean fundamental endorsement.",
      summary: `The model sees a ${tfLabel} opportunity, but the business backdrop is still strained, so the bullish call needs to be read as a setup trade with caveats.${confidenceText}`,
      tone: "balanced",
      bullets: [
        setupReason(weekly),
        `Fundamentals look ${postureLabel(posture)}: ${fundamentalsReason(evidence)}`,
        "So the rational reading is: the setup may work this week, but the business still has to earn a stronger long-term case.",
      ],
    };
  }

  if (weekly.signal === "SELL" && posture === "supportive") {
    return {
      title: "This week's SELL is about timing, not a verdict that the business is broken.",
      summary: `The business backdrop is better than the weekly signal, so this looks more like a ${tfLabel} risk-management call than a broad anti-fundamental stance.${confidenceText}`,
      tone: "balanced",
      bullets: [
        setupReason(weekly),
        `Fundamentals look ${postureLabel(posture)}: ${fundamentalsReason(evidence)}`,
        "So the rational reading is: the company may still be decent, but this week is not an attractive moment to press it.",
      ],
    };
  }

  return {
    title: "This week's call sits on a mixed fundamental backdrop.",
    summary: `The ${tfLabel} setup is doing some of the work here because the broader business picture is neither clearly confirming nor clearly rejecting the weekly signal.${confidenceText}`,
    tone: posture === "mixed" ? "balanced" : weekly.signal === "BUY" ? "supportive" : "cautious",
    bullets: [
      setupReason(weekly),
      `Fundamentals look ${postureLabel(posture)}: ${fundamentalsReason(evidence)}`,
      "That means the weekly recommendation should be read with the time horizon in mind, rather than as an all-purpose judgment on the stock.",
    ],
  };
}
