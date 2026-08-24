import { z } from "zod";

const toneSchema = z.enum(["supportive", "balanced", "cautious"]).catch("balanced");

const demandScenarioSchema = z.object({
  case: z.enum(["bear", "base", "bull"]).catch("base"),
  demandDriver: z.string().catch(""),
  demandChangePct: z.number().nullable().catch(null),
  businessTransmission: z.string().catch(""),
  earningsImpactPct: z.number().nullable().catch(null),
  equityImpactPct: z.number().nullable().catch(null),
  confidence: z.number().catch(0),
});

export const macroThesisSchema = z.object({
  secularBet: z.string().catch(""),
  dependencyChain: z.array(z.string()).catch([]),
  bottleneckRole: z.string().catch(""),
  consensusBlindSpot: z.string().catch(""),
  demandGap: z.string().catch(""),
  demandScenarios: z.array(demandScenarioSchema).catch([]),
  repricingTriggers: z.array(z.string()).catch([]),
  sCurvePosition: z
    .enum(["early_adopter", "crossing_chasm", "mainstream", "mature"])
    .catch("mainstream"),
  timeHorizon: z.enum(["2y", "5y", "10y+"]).catch("5y"),
  loadBearingAssumptions: z.array(z.string()).catch([]),
  falsificationSignals: z.array(z.string()).catch([]),
  opportunityScore: z.number().catch(0),
  confidence: z.number().catch(0),
});

export const signalSchema = z.object({
  signal: z.enum(["BUY", "SELL"]).catch("BUY"),
  weeklyCall: z.enum(["BUY", "SELL", "WAIT"]).catch("WAIT"),
  priorCallAssessment: z.string().nullable().optional().catch(null),
  cycle: z.enum(["ACCUMULATION", "MARKUP", "DISTRIBUTION", "MARKDOWN"]).catch("ACCUMULATION"),
  cycleTimeframe: z.enum(["SHORT", "MEDIUM", "LONG"]).catch("MEDIUM"),
  cycleStrength: z.number().catch(0),
  confidence: z.number().catch(0),
  weeklyOutlook: z.string().catch(""),
  keyBullishFactors: z.array(z.string()).catch([]),
  keyBearishFactors: z.array(z.string()).catch([]),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).catch("MEDIUM"),
  priceTarget: z.number().nullable().catch(null),
  stopLoss: z.number().nullable().catch(null),
  reasoning: z.string().catch(""),
  signalChanged: z.boolean().catch(false),
  weeklyTrend: z.enum(["uptrend", "downtrend", "sideways"]).catch("sideways"),
  pullbackTo21EMA: z.boolean().catch(false),
  consolidationBreakout21EMA: z.boolean().catch(false),
});

const thesisPillarSchema = z.object({
  value: z.string().catch(""),
  tone: toneSchema,
  summary: z.string().catch(""),
});

export const stockThesisSchema = z.object({
  title: z.string().catch(""),
  summary: z.string().catch(""),
  tone: toneSchema,
  confidence: z.number().catch(0),
  ownability: thesisPillarSchema,
  actionability: thesisPillarSchema,
  survivability: thesisPillarSchema,
  alignment: thesisPillarSchema,
  support: z.array(z.string()).catch([]),
  limits: z.array(z.string()).catch([]),
});

export const contextSchema = z.object({
  title: z.string().catch(""),
  summary: z.string().catch(""),
  takeaways: z.array(z.string()).catch([]),
});

export const analysisOutputSchema = z.object({
  context: contextSchema,
  signal: signalSchema,
  thesis: stockThesisSchema,
  opportunity: macroThesisSchema,
  memoryUpdate: z.string().catch(""),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

type DeepPartial<T> =
  T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

export type PartialAnalysisOutput = DeepPartial<AnalysisOutput>;
