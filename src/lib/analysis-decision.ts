type SetupData = {
  priceVsEMA21: number | null;
  priceVsWeeklyEMA21: number | null;
  earningsEventRisk: string;
  relativeStrengthVsMarket20d: number | null;
  earningsEstimateDelta90dPct: number | null;
};

export function buildAnalysisDecision(data: SetupData) {
  const daily = data.priceVsEMA21;
  const weekly = data.priceVsWeeklyEMA21;
  const hasTrend =
    daily != null && weekly != null && Number.isFinite(daily) && Number.isFinite(weekly);
  const up = hasTrend && daily > 0 && weekly > 0;
  const down = hasTrend && daily < 0 && weekly < 0;
  const weeklyTrend = up ? "uptrend" : down ? "downtrend" : "sideways";
  const signal = up ? "BUY" : down ? "SELL" : "WAIT";
  const keyBullishFactors: string[] = [];
  const keyBearishFactors: string[] = [];
  if (hasTrend) {
    const fact = `Daily 21 EMA distance: ${daily.toFixed(1)}%; weekly: ${weekly.toFixed(1)}%.`;
    (up ? keyBullishFactors : keyBearishFactors).push(fact);
  }
  if (data.relativeStrengthVsMarket20d != null) {
    const fact = `20-day relative return versus SPY: ${data.relativeStrengthVsMarket20d.toFixed(1)} percentage points.`;
    (data.relativeStrengthVsMarket20d >= 0 ? keyBullishFactors : keyBearishFactors).push(fact);
  }
  if (data.earningsEstimateDelta90dPct != null) {
    const fact = `90-day EPS estimate change: ${data.earningsEstimateDelta90dPct.toFixed(1)}%.`;
    (data.earningsEstimateDelta90dPct >= 0 ? keyBullishFactors : keyBearishFactors).push(fact);
  }
  if (data.earningsEventRisk === "imminent")
    keyBearishFactors.push("Earnings are within seven days.");
  if (!hasTrend) keyBearishFactors.push("Insufficient price history to establish the EMA trend.");

  // A trend is not an entry recommendation. No calibrated entry policy exists yet.
  const weeklyCall = "WAIT" as const;
  const reasoning = !hasTrend
    ? "Insufficient price history. No entry recommendation."
    : `Price is ${weeklyTrend === "uptrend" ? "above" : weeklyTrend === "downtrend" ? "below" : "on different sides of"} the daily and weekly 21 EMAs. Trend only; no entry recommendation.`;
  return {
    signal,
    weeklyCall,
    weeklyTrend,
    confidence: null,
    cycle: null,
    cycleTimeframe: null,
    riskLevel: data.earningsEventRisk === "imminent" ? ("HIGH" as const) : undefined,
    weeklyOutlook: reasoning,
    reasoning,
    keyBullishFactors,
    keyBearishFactors,
    pullbackTo21EMA: daily != null && Math.abs(daily) <= 2,
    consolidationBreakout21EMA: false,
    relativeStrengthVsMarket20d: data.relativeStrengthVsMarket20d,
    earningsEstimateDelta90dPct: data.earningsEstimateDelta90dPct,
    earningsEventRisk: data.earningsEventRisk,
  } as const;
}
