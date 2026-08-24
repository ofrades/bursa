import { useMemo, type ComponentProps } from "react";
import { Loader2, CircleAlert } from "lucide-react";
import type { StreamingState } from "../hooks/useStreamingAnalysis";
import { shouldShowLiveTranscript } from "../lib/stream-visibility";
import { macroThesisSchema, type PartialAnalysisOutput } from "../lib/analysis-output-schema";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { JsonSpecRenderer, buildMacroThesisSpec } from "../lib/json-render";
import { buildSimpleAnalysisSpec } from "../lib/simple-analysis-spec";
import type { MacroThesis, SimpleAnalysisEvidence } from "../lib/simple-analysis";
import {
  buildStockThesis,
  parseAIStockThesis,
  type WeeklyRecommendationContext,
} from "../lib/stock-thesis";
import { StockThesisCard } from "./StockThesisCard";
import { DividendCard } from "./DividendCard";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const STREAM_SECTION_MARKERS = [
  {
    marker: "1. OPPORTUNITY_JSON:",
    label: "Macro thesis",
    tone: "text-violet-700 dark:text-violet-300",
  },
  {
    marker: "2. CONTEXT_JSON:",
    label: "Business context",
    tone: "text-amber-700 dark:text-amber-300",
  },
  {
    marker: "3. THESIS_JSON:",
    label: "Thesis pillars",
    tone: "text-blue-700 dark:text-blue-300",
  },
  {
    marker: "4. SIGNAL_JSON:",
    label: "Weekly action",
    tone: "text-emerald-700 dark:text-emerald-300",
  },
  {
    marker: "5. MEMORY_UPDATE:",
    label: "Memory update",
    tone: "text-fuchsia-700 dark:text-fuchsia-300",
  },
] as const;

function splitStreamSections(text: string) {
  const markers = STREAM_SECTION_MARKERS.map((section) => ({
    ...section,
    index: text.indexOf(section.marker),
  })).filter((section) => section.index !== -1);

  if (markers.length === 0) {
    return text.trim()
      ? [
          {
            key: "live-output",
            label: "Live output",
            tone: "text-muted-foreground",
            body: text.trim(),
          },
        ]
      : [];
  }

  return markers
    .sort((a, b) => a.index - b.index)
    .map((section, index) => {
      const start = section.index + section.marker.length;
      const end = markers[index + 1]?.index ?? text.length;
      const body = text.slice(start, end).trim();

      return {
        key: section.marker,
        label: section.label,
        tone: section.tone,
        body,
      };
    });
}

function formatStreamSectionBody(body: string) {
  const trimmed = body.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      // Keep partial / invalid JSON as-is while streaming.
    }
  }

  return trimmed;
}

function LoadingMetricsSection() {
  return (
    <>
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-5 w-2/3" />
        </CardHeader>
        <CardContent className="space-y-2.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <Skeleton className="mb-4 h-3 w-24" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {["Quarterly revenue, net income & free cash flow", "Annual growth rate (YoY)"].map(
          (title) => (
            <Card key={title}>
              <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
                <Skeleton className="h-4 w-4/5" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-64 w-full rounded-xl" />
              </CardContent>
            </Card>
          ),
        )}
      </div>
    </>
  );
}

function LoadingTextCard({ label, lines = 2 }: { label: string; lines?: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">{label}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton key={index} className={index === lines - 1 ? "h-4 w-3/4" : "h-4 w-full"} />
        ))}
      </CardContent>
    </Card>
  );
}

function LoadingStockThesisCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-10 w-24 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-border/60 bg-muted/20 p-4">
            <Skeleton className="mb-3 h-3 w-24" />
            <Skeleton className="mb-2 h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function LoadingMacroThesisCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-6 w-4/5" />
            <div className="flex gap-2 pt-8">
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-7 w-24" />
            </div>
          </div>
          <Skeleton className="h-24 w-36 rounded-xl" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <LoadingPanelSkeleton />
          <LoadingPanelSkeleton />
        </div>
        <LoadingPanelSkeleton wide />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <LoadingPanelSkeleton />
          <LoadingPanelSkeleton />
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingPanelSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <Skeleton className="mb-3 h-3 w-32" />
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className={wide ? "h-4 w-5/6" : "h-4 w-3/4"} />
    </div>
  );
}

function ProgressiveMacroThesisCard({
  thesis,
}: {
  thesis: NonNullable<PartialAnalysisOutput["opportunity"]>;
}) {
  const score = thesis.opportunityScore ?? null;
  const confidence = thesis.confidence ?? null;
  const dependencyChain = thesis.dependencyChain ?? [];
  const repricingTriggers = thesis.repricingTriggers ?? [];
  const assumptions = thesis.loadBearingAssumptions ?? [];
  const falsificationSignals = thesis.falsificationSignals ?? [];
  const thesisSections: Array<[string, string[]]> = [
    ["Dependency chain", dependencyChain],
    ["Repricing triggers", repricingTriggers],
    ["Assumptions", assumptions],
    ["Falsification signals", falsificationSignals],
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Long-term thesis
            </p>
            <p className="mt-2 text-lg font-semibold leading-relaxed text-balance">
              {thesis.secularBet ? thesis.secularBet : "Building macro thesis…"}
            </p>
          </div>
          <div className="flex flex-col items-center rounded-xl border border-border/60 bg-muted/30 px-4 py-3 shrink-0">
            <span className="text-3xl font-bold tabular-nums">{score ?? "…"}</span>
            <span className="text-xs uppercase tracking-wider text-muted-foreground mt-0.5">
              opportunity
            </span>
            {confidence != null ? (
              <span className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                {Math.round(confidence)}% thesis conf
              </span>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              Bottleneck role
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {thesis.bottleneckRole ? thesis.bottleneckRole : "Waiting for bottleneck analysis…"}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              Consensus blind spot
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {thesis.consensusBlindSpot
                ? thesis.consensusBlindSpot
                : "Waiting for consensus read…"}
            </p>
          </div>
        </div>

        {thesis.demandGap ? (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Demand gap
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">{thesis.demandGap}</p>
          </div>
        ) : null}

        {dependencyChain.length ||
        repricingTriggers.length ||
        assumptions.length ||
        falsificationSignals.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {thesisSections.map(([label, items]) =>
              items.length ? (
                <div key={label} className="rounded-lg bg-muted/40 px-3 py-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                    {label}
                  </p>
                  <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground leading-relaxed">
                    {items.map((item, index) => (
                      <li key={index} className="flex gap-2">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function StreamingAnalysis({
  state,
  simpleAnalysis = null,
  dividendData = null,
  saveState = "idle",
  saveError = null,
}: {
  state: StreamingState;
  simpleAnalysis?: SimpleAnalysisEvidence | null;
  dividendData?: ComponentProps<typeof DividendCard>["data"] | null;
  saveState?: "idle" | "saving" | "error";
  saveError?: string | null;
}) {
  const streamSections = useMemo(() => splitStreamSections(state.text), [state.text]);
  const output = state.final ?? state.partial;

  const opportunity = output.opportunity ?? null;
  const signal = output.signal ?? null;
  const aiThesis = output.thesis ?? null;
  const aiContext = output.context ?? null;

  // Merge AI-generated context into the pre-loaded market evidence so the
  // ContextCard shows company-specific copy while streaming.
  const enrichedSimpleAnalysis = useMemo(() => {
    if (!simpleAnalysis) return null;
    if (!aiContext) return simpleAnalysis;
    const merged = { ...simpleAnalysis };
    if (aiContext.title) {
      merged.title = aiContext.title;
    }
    if (aiContext.summary) {
      merged.summary = aiContext.summary;
    }
    if (aiContext.takeaways) {
      merged.takeaways = aiContext.takeaways.map(String);
    }
    return merged;
  }, [simpleAnalysis, aiContext]);

  const hasOpportunity = opportunity != null;
  const hasSignal = signal != null;
  const showLiveTranscript = shouldShowLiveTranscript(state, hasOpportunity);
  const macroThesisSpec = useMemo(() => {
    if (!hasOpportunity || !state.final) return null;
    try {
      return buildMacroThesisSpec(macroThesisSchema.parse(opportunity));
    } catch {
      return null;
    }
  }, [hasOpportunity, opportunity, state.final]);

  const simpleAnalysisSpec = useMemo(() => {
    if (!enrichedSimpleAnalysis) return null;
    try {
      return buildSimpleAnalysisSpec(enrichedSimpleAnalysis);
    } catch {
      return null;
    }
  }, [enrichedSimpleAnalysis]);

  const stockThesis = useMemo(() => {
    if (!hasSignal) return null;

    const weeklyContext: WeeklyRecommendationContext = {
      signal: signal?.signal === "SELL" ? "SELL" : "BUY",
      weeklyCall: signal?.weeklyCall ?? null,
      cycle: signal?.cycle ?? null,
      cycleTimeframe: signal?.cycleTimeframe ?? null,
      confidence: signal?.confidence ?? null,
      riskLevel: signal?.riskLevel,
      weeklyTrend: signal?.weeklyTrend,
      pullbackTo21EMA: signal?.pullbackTo21EMA,
      consolidationBreakout21EMA: signal?.consolidationBreakout21EMA,
      weeklyOutlook: signal?.weeklyOutlook,
      reasoning: signal?.reasoning,
      keyBullishFactors: signal?.keyBullishFactors,
      keyBearishFactors: signal?.keyBearishFactors,
    };
    const macroThesis = (opportunity as MacroThesis | null | undefined) ?? null;

    // Prefer the AI-generated thesis narrative, but ground its pillars against
    // the same metrics evidence card the user sees while streaming.
    if (aiThesis) {
      try {
        return parseAIStockThesis(aiThesis, signal?.confidence ?? null, {
          evidence: enrichedSimpleAnalysis,
          weekly: weeklyContext,
          macroThesis,
          hasExtremeRisk: false,
        });
      } catch {
        // fall through to buildStockThesis
      }
    }
    if (!enrichedSimpleAnalysis) return null;
    try {
      return buildStockThesis(weeklyContext, enrichedSimpleAnalysis, {
        hasExtremeRisk: false,
        macroThesis,
      });
    } catch {
      return null;
    }
  }, [hasSignal, aiThesis, enrichedSimpleAnalysis, opportunity, signal]);

  const liveTranscriptCard = showLiveTranscript ? (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardDescription className="text-xs uppercase tracking-wider mb-1">
              Live transcript
            </CardDescription>
            <CardTitle className="text-base">Streaming model output</CardTitle>
          </div>
          <Badge variant="outline" className="font-mono text-[11px]">
            {state.isLoading ? "streaming" : "final"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {streamSections.map((section, index) => {
          const isActive = state.isLoading && index === streamSections.length - 1;
          const content = formatStreamSectionBody(section.body);

          return (
            <div key={section.key} className="rounded-xl border bg-muted/25 overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b bg-background/80 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-xs font-semibold uppercase tracking-wider ${section.tone}`}
                  >
                    {section.label}
                  </span>
                  {isActive && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {section.body.trim() ? `${section.body.trim().length} chars` : "pending"}
                </span>
              </div>
              <div className="px-3 py-3">
                {content ? (
                  <pre className="text-[11px] leading-5 text-foreground/85 whitespace-pre-wrap break-words font-mono selection:bg-primary/15">
                    {content}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Waiting for content…</p>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  ) : null;

  const signalReasoning = hasSignal && signal?.reasoning ? signal.reasoning : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Status row: live transcript + loading + errors */}
      {liveTranscriptCard}
      {state.error && (
        <Card className="border-red-200">
          <CardContent className="flex items-start gap-3 py-5">
            <CircleAlert className="size-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Analysis failed</p>
              <p className="text-sm text-muted-foreground">{state.error}</p>
            </div>
          </CardContent>
        </Card>
      )}
      {state.warning && !state.error && (
        <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-800/40 dark:bg-amber-950/20">
          <CardContent className="flex items-start gap-3 py-5">
            <CircleAlert className="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-amber-900 dark:text-amber-200">
                Partial analysis received
              </p>
              <p className="text-sm text-amber-800/90 dark:text-amber-300/90">{state.warning}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* METRICS section — same shape as the resting page so data appears
          in the right place as the model streams it. */}
      {(state.isLoading || simpleAnalysisSpec || dividendData) && (
        <section aria-label="Metrics" className="flex flex-col gap-4">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Metrics</h2>
          {simpleAnalysisSpec ? (
            <JsonSpecRenderer spec={simpleAnalysisSpec} />
          ) : (
            <LoadingMetricsSection />
          )}
          {dividendData && <DividendCard data={dividendData} />}
        </section>
      )}

      {/* THESIS section — appears section by section as the model finishes
          each JSON block (Why → Short-term → Long-term). */}
      {(state.isLoading || signalReasoning || stockThesis || hasOpportunity) && (
        <section aria-label="Thesis" className="flex flex-col gap-4">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Thesis</h2>

          {signalReasoning ? (
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase tracking-wider">
                  Why this read
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">{signalReasoning}</p>
              </CardContent>
            </Card>
          ) : state.isLoading ? (
            <LoadingTextCard label="Why this read" />
          ) : null}

          {stockThesis ? (
            <StockThesisCard thesis={stockThesis} />
          ) : state.isLoading ? (
            <LoadingStockThesisCard />
          ) : null}

          {macroThesisSpec ? (
            <JsonSpecRenderer spec={macroThesisSpec} />
          ) : hasOpportunity ? (
            <ProgressiveMacroThesisCard thesis={opportunity} />
          ) : state.isLoading ? (
            <LoadingMacroThesisCard />
          ) : null}
        </section>
      )}

      {/* Auto-save status */}
      {state.isComplete && saveState === "saving" && (
        <div className="flex justify-end">
          <span className="text-xs text-muted-foreground">Saving analysis…</span>
        </div>
      )}

      {state.isComplete && saveState === "error" && saveError && (
        <Card className="border-red-200">
          <CardContent className="flex items-start gap-3 py-5">
            <CircleAlert className="size-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Failed to save analysis</p>
              <p className="text-sm text-muted-foreground">{saveError}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
