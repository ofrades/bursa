import { useMemo } from "react";
import { Loader2, CircleAlert } from "lucide-react";
import { parseSections } from "../lib/stream-parsing";
import type { StreamingState } from "../hooks/useStreamingAnalysis";
import { Badge, SignalBadge, CycleBadge, SupervisorBadge } from "./ui/badge";
import type { Signal, Cycle, SupervisorSeverity } from "./ui/badge";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

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
                {signal.cycle && (
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

            {signal.weeklyOutlook && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Weekly outlook
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {String(signal.weeklyOutlook)}
                </p>
              </div>
            )}

            {signal.reasoning && (
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

      {/* Raw text preview while streaming */}
      {state.isLoading && state.text.length > 0 && !hasSignal && (
        <Card>
          <CardHeader>
            <CardDescription className="text-xs uppercase tracking-wider">
              Raw stream
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
              {state.text}
            </pre>
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
