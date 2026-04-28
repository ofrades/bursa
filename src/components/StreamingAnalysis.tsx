import { useMemo } from "react";
import { Loader2, CircleAlert } from "lucide-react";
import { parseSections } from "../lib/stream-parsing";
import type { StreamingState } from "../hooks/useStreamingAnalysis";
import { shouldShowLiveTranscript } from "../lib/stream-visibility";
import { Badge, SignalBadge } from "./ui/badge";
import { JsonSpecRenderer, buildMacroThesisSpec } from "../lib/json-render";
import { buildSimpleAnalysisSpec } from "../lib/simple-analysis-spec";
import { getWeeklyRecommendationDisplay } from "../lib/recommendation-labels";
import type { MacroThesis, SimpleAnalysisEvidence } from "../lib/simple-analysis";
import { buildStockThesis } from "../lib/stock-thesis";
import { StockThesisCard } from "./StockThesisCard";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const STREAM_SECTION_MARKERS = [
  {
    marker: "1. OPPORTUNITY_JSON:",
    label: "Macro thesis",
    tone: "text-violet-700 dark:text-violet-300",
  },
  {
    marker: "2. SIGNAL_JSON:",
    label: "Weekly signal",
    tone: "text-emerald-700 dark:text-emerald-300",
  },
  {
    marker: "3. MEMORY_UPDATE:",
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

function moneyStr(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: v >= 100 ? 0 : 2,
  }).format(v);
}

export function StreamingAnalysis({
  state,
  simpleAnalysis = null,
  saveState = "idle",
  saveError = null,
}: {
  state: StreamingState;
  simpleAnalysis?: SimpleAnalysisEvidence | null;
  saveState?: "idle" | "saving" | "error";
  saveError?: string | null;
}) {
  const sections = useMemo(() => parseSections(state.text), [state.text]);
  const streamSections = useMemo(() => splitStreamSections(state.text), [state.text]);

  const opportunity = sections.opportunityJson;
  const signal = sections.signalJson;

  const hasOpportunity = opportunity != null;
  const hasSignal = signal != null;
  const showLiveTranscript = shouldShowLiveTranscript(state, hasOpportunity);
  const weeklyRecommendation = hasSignal
    ? getWeeklyRecommendationDisplay(
        JSON.stringify(signal),
        (signal?.signal as string | undefined) ?? null,
        (signal?.confidence as number | undefined) ?? null,
      )
    : null;
  const macroThesisSpec = useMemo(() => {
    if (!hasOpportunity) return null;
    try {
      return buildMacroThesisSpec(opportunity as unknown as MacroThesis);
    } catch {
      return null;
    }
  }, [hasOpportunity, opportunity]);

  const simpleAnalysisSpec = useMemo(() => {
    if (!simpleAnalysis) return null;
    try {
      return buildSimpleAnalysisSpec(simpleAnalysis);
    } catch {
      return null;
    }
  }, [simpleAnalysis]);

  const stockThesis = useMemo(() => {
    if (!hasSignal || !simpleAnalysis) return null;
    try {
      return buildStockThesis(
        {
          signal: String(signal?.signal) as "BUY" | "SELL",
          cycle: (signal?.cycle as string | null | undefined) ?? null,
          cycleTimeframe:
            (signal?.cycleTimeframe as "SHORT" | "MEDIUM" | "LONG" | null | undefined) ?? null,
          confidence: (signal?.confidence as number | null | undefined) ?? null,
          riskLevel: (signal?.riskLevel as "LOW" | "MEDIUM" | "HIGH" | undefined) ?? undefined,
          weeklyTrend:
            (signal?.weeklyTrend as "uptrend" | "downtrend" | "sideways" | undefined) ?? undefined,
          pullbackTo21EMA: (signal?.pullbackTo21EMA as boolean | undefined) ?? undefined,
          consolidationBreakout21EMA:
            (signal?.consolidationBreakout21EMA as boolean | undefined) ?? undefined,
          weeklyOutlook: (signal?.weeklyOutlook as string | undefined) ?? undefined,
          reasoning: (signal?.reasoning as string | undefined) ?? undefined,
          keyBullishFactors: (signal?.keyBullishFactors as string[] | undefined) ?? undefined,
          keyBearishFactors: (signal?.keyBearishFactors as string[] | undefined) ?? undefined,
        },
        simpleAnalysis,
        {
          hasExtremeRisk: false,
          macroThesis: (opportunity as MacroThesis | null | undefined) ?? null,
        },
      );
    } catch {
      return null;
    }
  }, [hasSignal, opportunity, signal, simpleAnalysis]);

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

  return (
    <div className="flex flex-col gap-4">
      {/* Loading indicator */}
      {state.isLoading && !state.isComplete && (
        <Card>
          <CardContent className="flex items-center gap-3 py-5">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Analyzing…</span>
          </CardContent>
        </Card>
      )}

      {liveTranscriptCard}

      {/* Error */}
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

      {/* Warning */}
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

      {/* ─── CORNERSTONE: Macro Thesis ─── */}
      {macroThesisSpec && <JsonSpecRenderer spec={macroThesisSpec} />}

      {simpleAnalysisSpec && <JsonSpecRenderer spec={simpleAnalysisSpec} />}

      {stockThesis && <StockThesisCard thesis={stockThesis} />}

      {/* ─── SIGNAL — flows from thesis ─── */}
      {hasSignal && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardDescription className="text-xs uppercase tracking-wider mb-0.5">
                  Weekly timing
                </CardDescription>
                <CardTitle className="text-xl">Weekly setup</CardTitle>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <SignalBadge signal={weeklyRecommendation?.value ?? "HOLD"} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: "Confidence",
                  value: typeof signal.confidence === "number" ? `${signal.confidence}%` : "—",
                },
                {
                  label: "Risk",
                  value: (signal.riskLevel as string) ?? "—",
                },
                {
                  label: "Price target",
                  value: moneyStr(signal.priceTarget as number | null),
                },
                {
                  label: "Stop loss",
                  value: moneyStr(signal.stopLoss as number | null),
                },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-muted/60 px-3 py-3">
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  <p className="text-base font-semibold">{value}</p>
                </div>
              ))}
            </div>

            {Boolean(signal.weeklyOutlook) && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Weekly setup
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {String(signal.weeklyOutlook)}
                </p>
              </div>
            )}

            {Boolean(signal.reasoning) && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Weekly read
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {String(signal.reasoning)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* What helps / what to watch */}
      {hasSignal && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardDescription className="text-xs uppercase tracking-wider">
                What helps
              </CardDescription>
            </CardHeader>
            <CardContent>
              {Array.isArray(signal.keyBullishFactors) && signal.keyBullishFactors.length ? (
                <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc pl-4 leading-relaxed">
                  {signal.keyBullishFactors.map((item: unknown, i: number) => (
                    <li key={i}>{String(item)}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No clear helpers yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription className="text-xs uppercase tracking-wider">
                What to watch
              </CardDescription>
            </CardHeader>
            <CardContent>
              {Array.isArray(signal.keyBearishFactors) && signal.keyBearishFactors.length ? (
                <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc pl-4 leading-relaxed">
                  {signal.keyBearishFactors.map((item: unknown, i: number) => (
                    <li key={i}>{String(item)}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No clear watch-outs yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
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
