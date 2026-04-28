import { useMemo } from "react";
import { Loader2, CircleAlert } from "lucide-react";
import { parseSections } from "../lib/stream-parsing";
import type { StreamingState } from "../hooks/useStreamingAnalysis";
import { Badge, SignalBadge } from "./ui/badge";
import type { Signal } from "./ui/badge";
import { JsonSpecRenderer, buildMacroThesisSpec } from "../lib/json-render";
import type { MacroThesis } from "../lib/simple-analysis";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const STREAM_SECTION_MARKERS = [
  {
    marker: "1. OPPORTUNITY_JSON:",
    label: "Macro thesis",
    tone: "text-violet-700 dark:text-violet-300",
  },
  {
    marker: "2. SIGNAL_JSON:",
    label: "Signal",
    tone: "text-emerald-700 dark:text-emerald-300",
  },
  {
    marker: "3. TALEB_JSON:",
    label: "Stress check",
    tone: "text-amber-700 dark:text-amber-300",
  },
  {
    marker: "4. BUFFETT_JSON:",
    label: "Price check",
    tone: "text-blue-700 dark:text-blue-300",
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

function moneyStr(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: v >= 100 ? 0 : 2,
  }).format(v);
}

function severityClasses(severity: string | undefined) {
  switch (severity) {
    case "EXTREME":
      return "border-red-200 bg-red-50 text-red-800 dark:border-red-800/40 dark:bg-red-950/40 dark:text-red-300";
    case "HIGH":
      return "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800/40 dark:bg-orange-950/40 dark:text-orange-300";
    case "MEDIUM":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function StreamingAnalysis({
  state,
  saveState = "idle",
  saveError = null,
}: {
  state: StreamingState;
  saveState?: "idle" | "saving" | "error";
  saveError?: string | null;
}) {
  const sections = useMemo(() => parseSections(state.text), [state.text]);
  const streamSections = useMemo(() => splitStreamSections(state.text), [state.text]);

  const opportunity = sections.opportunityJson;
  const signal = sections.signalJson;
  const taleb = sections.talebJson;
  const buffett = sections.buffettJson;

  const hasOpportunity = opportunity != null;
  const hasSignal = signal != null;
  const hasTaleb = taleb != null;
  const hasBuffett = buffett != null;

  const macroThesisSpec = useMemo(() => {
    if (!hasOpportunity) return null;
    try {
      return buildMacroThesisSpec(opportunity as unknown as MacroThesis);
    } catch {
      return null;
    }
  }, [hasOpportunity, opportunity]);

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

      {/* ─── SIGNAL — flows from thesis ─── */}
      {hasSignal && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardDescription className="text-xs uppercase tracking-wider mb-0.5">
                  Timing to act on the thesis
                </CardDescription>
                <CardTitle className="text-xl">Current setup</CardTitle>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <SignalBadge signal={(signal.signal as Signal) ?? "HOLD"} />
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
                  Setup
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {String(signal.weeklyOutlook)}
                </p>
              </div>
            )}

            {Boolean(signal.reasoning) && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Read
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

      {/* ─── SUPERVISORS: Taleb + Buffett ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {hasTaleb && taleb && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <CardDescription className="text-xs uppercase tracking-wider">
                    Stress check
                  </CardDescription>
                  <CardTitle className="text-base leading-tight">
                    {String(taleb.title ?? "")}
                  </CardTitle>
                </div>
                <Badge variant="outline" className={severityClasses(taleb.severity as string)}>
                  {String(taleb.severity ?? "LOW")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {String(taleb.content ?? "")}
              </p>
            </CardContent>
          </Card>
        )}

        {hasBuffett && buffett && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <CardDescription className="text-xs uppercase tracking-wider">
                    Price check
                  </CardDescription>
                  <CardTitle className="text-base leading-tight">
                    {String(buffett.title ?? "")}
                  </CardTitle>
                </div>
                <Badge variant="outline" className={severityClasses(buffett.severity as string)}>
                  {String(buffett.severity ?? "LOW")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {String(buffett.content ?? "")}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Progressive transcript before the structured cards can take over. */}
      {state.text.length > 0 && !hasOpportunity && (
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
                      {isActive && (
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                      )}
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
