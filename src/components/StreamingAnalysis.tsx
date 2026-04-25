import { useMemo } from "react";
import { Loader2, CircleAlert } from "lucide-react";
import { parseSections } from "../lib/stream-parsing";
import type { StreamingState } from "../hooks/useStreamingAnalysis";
import { Badge, SignalBadge, CycleBadge, SupervisorBadge } from "./ui/badge";
import type { Signal, Cycle, SupervisorSeverity } from "./ui/badge";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const STREAM_SECTION_MARKERS = [
  {
    marker: "1. SIGNAL_JSON:",
    label: "Signal JSON",
    tone: "text-emerald-700 dark:text-emerald-300",
  },
  { marker: "2. TALEB_JSON:", label: "Taleb JSON", tone: "text-amber-700 dark:text-amber-300" },
  { marker: "3. BUFFETT_JSON:", label: "Buffett JSON", tone: "text-blue-700 dark:text-blue-300" },
  {
    marker: "4. MEMORY_UPDATE:",
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

function CycleStrengthBar({ strength }: { strength: number | null }) {
  if (strength == null) return null;
  const pct = Math.max(0, Math.min(100, strength));
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
    </div>
  );
}

function SetupChecklistPartial({
  weeklyTrend,
  pullback,
  breakout,
}: {
  weeklyTrend?: string;
  pullback?: boolean;
  breakout?: boolean;
}) {
  const items = [
    { label: "Weekly trend", value: weeklyTrend ?? "—", ok: weeklyTrend === "uptrend" },
    {
      label: "Pullback to 21 EMA",
      value: pullback === true ? "Yes" : pullback === false ? "No" : "—",
      ok: pullback === true,
    },
    {
      label: "Consolidation breakout",
      value: breakout === true ? "Yes" : breakout === false ? "No" : "—",
      ok: breakout === true,
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between">
          <span className="text-sm">{item.label}</span>
          <Badge
            variant="outline"
            className={
              item.ok
                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/40"
                : undefined
            }
          >
            {item.value}
          </Badge>
        </div>
      ))}
    </div>
  );
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

  const signal = sections.signalJson;
  const taleb = sections.talebJson;
  const buffett = sections.buffettJson;

  const hasSignal = signal != null;
  const hasTaleb = taleb != null;
  const hasBuffett = buffett != null;

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

      {/* Signal card — progressively appears */}
      {hasSignal && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardDescription className="text-xs uppercase tracking-wider mb-0.5">
                  AI analysis
                </CardDescription>
                <CardTitle className="text-xl">Weekly recommendation</CardTitle>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <SignalBadge signal={(signal.signal as Signal) ?? "HOLD"} />
                {Boolean(signal.cycle) && (
                  <CycleBadge
                    cycle={signal.cycle as Cycle}
                    timeframe={(signal.cycleTimeframe as string) ?? null}
                  />
                )}
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

            {typeof signal.cycleStrength === "number" && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Cycle phase
                </p>
                <div className="flex items-center gap-2 mb-1">
                  <CycleBadge cycle={signal.cycle as Cycle} />
                </div>
                <CycleStrengthBar strength={signal.cycleStrength as number} />
                <p className="text-xs text-muted-foreground mt-1">
                  {signal.cycleTimeframe === "SHORT" && "Days to 2 weeks — price action driven"}
                  {signal.cycleTimeframe === "MEDIUM" &&
                    "Weeks to a quarter — SMA & earnings driven"}
                  {signal.cycleTimeframe === "LONG" &&
                    "Quarters to a year — fundamentals & macro driven"}
                </p>
              </div>
            )}

            {Boolean(signal.weeklyOutlook) && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Weekly outlook
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {String(signal.weeklyOutlook)}
                </p>
              </div>
            )}

            {Boolean(signal.reasoning) && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Reasoning
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {String(signal.reasoning)}
                </p>
              </div>
            )}

            <SetupChecklistPartial
              weeklyTrend={signal.weeklyTrend as string | undefined}
              pullback={signal.pullbackTo21EMA as boolean | undefined}
              breakout={signal.consolidationBreakout21EMA as boolean | undefined}
            />
          </CardContent>
        </Card>
      )}

      {/* Bullish / Bearish factors */}
      {hasSignal && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardDescription className="text-xs uppercase tracking-wider">
                Bullish factors
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
                <p className="text-sm text-muted-foreground">No bullish factors yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription className="text-xs uppercase tracking-wider">
                Bearish factors
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
                <p className="text-sm text-muted-foreground">No bearish factors yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Supervisors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {hasTaleb && taleb && (
          <Card
            className={
              taleb.severity === "EXTREME"
                ? "border-red-300 dark:border-red-700"
                : taleb.severity === "HIGH"
                  ? "border-orange-200 dark:border-orange-800"
                  : ""
            }
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🦢</span>
                    <CardDescription className="text-xs uppercase tracking-wider">
                      Nassim Taleb
                    </CardDescription>
                  </div>
                  <CardTitle className="text-base leading-tight">
                    {String(taleb.title ?? "")}
                  </CardTitle>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <SupervisorBadge
                    supervisor="TALEB"
                    severity={(taleb.severity as SupervisorSeverity) ?? "LOW"}
                  />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {(taleb.alertType as string) ?? ""}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed italic">
                "{String(taleb.content ?? "")}"
              </p>
            </CardContent>
          </Card>
        )}

        {hasBuffett && buffett && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🎩</span>
                    <CardDescription className="text-xs uppercase tracking-wider">
                      Warren Buffett
                    </CardDescription>
                  </div>
                  <CardTitle className="text-base leading-tight">
                    {String(buffett.title ?? "")}
                  </CardTitle>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <SupervisorBadge
                    supervisor="BUFFETT"
                    severity={(buffett.severity as SupervisorSeverity) ?? "LOW"}
                  />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {(buffett.alertType as string) ?? ""}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed italic">
                "{String(buffett.content ?? "")}"
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Progressive transcript before the structured cards can take over. */}
      {state.text.length > 0 && !hasSignal && (
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
