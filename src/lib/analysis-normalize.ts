import { z } from "zod";
import {
  macroThesisSchema,
  signalSchema,
  stockThesisSchema,
  type AnalysisOutput,
} from "./analysis-output-schema";

const scoreInput = z.union([z.number(), z.string()]);

export function normalizeScore(value: number | string | null | undefined): number | null {
  const parsed = scoreInput.safeParse(value);
  if (!parsed.success) return null;
  const raw = Number(parsed.data);
  if (!Number.isFinite(raw)) return null;
  const scaled = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

function sanitizeMemoryUpdate(symbol: string, memory: string | null): string | null {
  if (!memory) return null;

  const lines = memory
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*##\s*STOCK MEMORY \(accumulated context\)\s*$/i.test(line.trim()))
    .join("\n")
    .trim();

  if (!lines) return null;

  const normalizedSymbol = symbol.toUpperCase();
  const hasTitle = new RegExp(
    `^#\\s+${normalizedSymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "im",
  ).test(lines);

  return hasTitle ? lines : `# ${normalizedSymbol} — Stock Memory\n\n${lines}`;
}

export function normalizeAnalysisOutput(output: AnalysisOutput): AnalysisOutput {
  const next = structuredClone(output);

  next.opportunity.opportunityScore =
    normalizeScore(next.opportunity.opportunityScore) ?? next.opportunity.opportunityScore;
  next.opportunity.confidence =
    normalizeScore(next.opportunity.confidence) ?? next.opportunity.confidence;
  next.opportunity.demandScenarios = next.opportunity.demandScenarios.map((scenario) => ({
    ...scenario,
    confidence: normalizeScore(scenario.confidence) ?? scenario.confidence,
  }));

  next.thesis.confidence = normalizeScore(next.thesis.confidence) ?? next.thesis.confidence;

  next.signal.cycleStrength =
    normalizeScore(next.signal.cycleStrength) ?? next.signal.cycleStrength;
  next.signal.confidence = normalizeScore(next.signal.confidence) ?? next.signal.confidence;

  return next;
}

type NormalizableSections = {
  signal: z.infer<typeof signalSchema>;
  opportunityJson: z.infer<typeof macroThesisSchema> | null;
  thesisJson: z.infer<typeof stockThesisSchema> | null;
  memoryUpdate: string | null;
};

export function normalizeParsedAnalysisSections<S extends NormalizableSections>(
  parsed: S,
  symbol: string,
): S {
  const signal = parsed.signal;
  signal.cycleStrength = normalizeScore(signal.cycleStrength) ?? signal.cycleStrength;
  signal.confidence = normalizeScore(signal.confidence) ?? signal.confidence;

  const opportunity = parsed.opportunityJson;
  if (opportunity) {
    opportunity.opportunityScore =
      normalizeScore(opportunity.opportunityScore) ?? opportunity.opportunityScore;
    opportunity.confidence = normalizeScore(opportunity.confidence) ?? opportunity.confidence;
    opportunity.demandScenarios = opportunity.demandScenarios.map((scenario) => ({
      ...scenario,
      confidence: normalizeScore(scenario.confidence) ?? scenario.confidence,
    }));
  }

  const thesis = parsed.thesisJson;
  if (thesis) {
    thesis.confidence = normalizeScore(thesis.confidence) ?? thesis.confidence;
  }

  const memoryUpdate = sanitizeMemoryUpdate(symbol, parsed.memoryUpdate);
  return { ...parsed, memoryUpdate };
}
