import { createFileRoute, useRouter } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  CircleAlert,
  Loader2,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import { cn } from "#/lib/utils";
import {
  Badge,
  SignalBadge,
  CycleBadge,
  SupervisorBadge,
  type Cycle,
  type SupervisorSeverity,
} from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardAction,
} from "../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { getStockPageData } from "../server/stocks";
import { saveWeeklyAnalysis } from "../server/recommend";
import { useStreamingAnalysis } from "../hooks/useStreamingAnalysis";
import { StreamingAnalysis } from "../components/StreamingAnalysis";

export const Route = createFileRoute("/$symbol")({
  loader: async ({ params }) => {
    const symbol = params.symbol.toUpperCase();
    return getStockPageData({ data: { symbol } });
  },
  component: StockPage,
});

type ParsedRecommendation = {
  weeklyOutlook?: string;
  reasoning?: string;
  riskLevel?: string;
  priceTarget?: number | null;
  stopLoss?: number | null;
  keyBullishFactors?: string[];
  keyBearishFactors?: string[];
  weeklyTrend?: "uptrend" | "downtrend" | "sideways";
  pullbackTo21EMA?: boolean;
  consolidationBreakout21EMA?: boolean;
};

function parseRecommendation(value: unknown): ParsedRecommendation | null {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value) as ParsedRecommendation;
  } catch {
    return null;
  }
}

function moneyStr(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: v >= 100 ? 0 : 2,
  }).format(v);
}

function dateStr(v: string | Date | null | undefined, withTime = false) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

// ─── Supervisor card ──────────────────────────────────────────────────────────

function SupervisorCard({
  supervisor,
  alertType,
  severity,
  title,
  content,
}: {
  supervisor: "TALEB" | "BUFFETT";
  alertType: string;
  severity: SupervisorSeverity;
  title: string;
  content: string;
}) {
  const isTaleb = supervisor === "TALEB";
  const borderClass =
    severity === "EXTREME"
      ? "border-red-300 dark:border-red-700"
      : severity === "HIGH"
        ? "border-orange-200 dark:border-orange-800"
        : "";

  return (
    <Card className={cn("transition-colors", borderClass)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-base">{isTaleb ? "🦢" : "🎩"}</span>
              <CardDescription className="text-xs uppercase tracking-wider">
                {isTaleb ? "Nassim Taleb" : "Warren Buffett"}
              </CardDescription>
            </div>
            <CardTitle className="text-base leading-tight">{title}</CardTitle>
          </div>
          <div className="flex flex-col items-end gap-1">
            <SupervisorBadge supervisor={supervisor} severity={severity} />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {alertType.replaceAll("_", " ")}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground leading-relaxed italic">"{content}"</p>
      </CardContent>
    </Card>
  );
}

// ─── Cycle strength bar ───────────────────────────────────────────────────────

function CycleStrengthBar({ strength }: { strength: number | null }) {
  if (strength == null) return null;
  const pct = Math.max(0, Math.min(100, strength));
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
    </div>
  );
}

function SetupChecklist({ rec }: { rec: ParsedRecommendation | null }) {
  if (!rec) return null;
  const items = [
    {
      label: "Weekly trend",
      value: rec.weeklyTrend ?? "—",
      ok: rec.weeklyTrend === "uptrend",
    },
    {
      label: "Pullback to 21 EMA",
      value: rec.pullbackTo21EMA === true ? "Yes" : rec.pullbackTo21EMA === false ? "No" : "—",
      ok: rec.pullbackTo21EMA === true,
    },
    {
      label: "Consolidation breakout near 21 EMA",
      value:
        rec.consolidationBreakout21EMA === true
          ? "Yes"
          : rec.consolidationBreakout21EMA === false
            ? "No"
            : "—",
      ok: rec.consolidationBreakout21EMA === true,
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardDescription className="text-xs uppercase tracking-wider">
          Setup checklist
        </CardDescription>
        <CardTitle className="text-lg">Strategy criteria</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
      </CardContent>
    </Card>
  );
}

function StockPage() {
  const data = Route.useLoaderData();
  const params = Route.useParams();
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const symbol = params.symbol.toUpperCase();

  const { state: streamState, start: startStream, reset: resetStream } = useStreamingAnalysis();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSavedPayloadRef = React.useRef<string | null>(null);

  const handleAnalyze = () => {
    lastSavedPayloadRef.current = null;
    setSaveState("idle");
    setSaveError(null);
    startStream(symbol);
  };

  // Auto-save streamed analysis to DB when complete
  useEffect(() => {
    const rawText = streamState.text.trim();
    if (!streamState.isComplete || !rawText || streamState.error) return;
    if (lastSavedPayloadRef.current === rawText) return;

    let cancelled = false;
    lastSavedPayloadRef.current = rawText;
    setSaveState("saving");
    setSaveError(null);

    void (async () => {
      try {
        await saveWeeklyAnalysis({ data: { symbol, rawText } });
        if (cancelled) return;

        await router.invalidate();
        if (cancelled) return;

        resetStream();
        setSaveState("idle");
        setSaveError(null);
        lastSavedPayloadRef.current = null;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Save failed";
        if (cancelled) return;

        setSaveState("error");
        setSaveError(msg);
        lastSavedPayloadRef.current = null;
        // eslint-disable-next-line no-console
        console.error("Auto-save failed:", msg);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resetStream, router, streamState.error, streamState.isComplete, streamState.text, symbol]);
  const stock = data.stock;
  const latestAnalysis = data.latestAnalysis;
  const recommendation = parseRecommendation(latestAnalysis?.reasoning);
  const bullishFactors = recommendation?.keyBullishFactors ?? [];
  const bearishFactors = recommendation?.keyBearishFactors ?? [];

  // Supervisor alerts: pick the latest per supervisor
  const alerts = data.supervisorAlerts ?? [];
  const talebAlert = alerts.find((a) => a.supervisor === "TALEB") ?? null;
  const buffettAlert = alerts.find((a) => a.supervisor === "BUFFETT") ?? null;
  const hasExtreme = alerts.some((a) => a.severity === "EXTREME");

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto w-full px-6 py-8 flex flex-col gap-4">
        {/* Top nav */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Button asChild variant="ghost" size="sm">
            <a href="/">
              <ChevronLeft className="size-4" /> Back
            </a>
          </Button>
          <div className="flex items-center gap-2 flex-wrap">
            {stock?.exchange && <Badge variant="outline">{stock.exchange}</Badge>}
            {latestAnalysis ? (
              <div className="flex items-center gap-1.5">
                <Sparkles className="size-3 text-muted-foreground" />
                <SignalBadge signal={latestAnalysis.signal} />
                {latestAnalysis.cycle && (
                  <CycleBadge
                    cycle={latestAnalysis.cycle as Cycle}
                    timeframe={latestAnalysis.cycleTimeframe}
                  />
                )}
              </div>
            ) : (
              <Badge variant="outline">No analysis yet</Badge>
            )}
            {hasExtreme && (
              <Badge
                variant="outline"
                className="border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300"
              >
                <ShieldAlert className="size-3" /> Extreme alert
              </Badge>
            )}
          </div>
          {session && (
            <div className="flex items-center gap-2">
              {streamState.error && (
                <span className="text-xs text-red-500">{streamState.error}</span>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={streamState.isLoading}
                onClick={handleAnalyze}
              >
                {streamState.isLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {streamState.isLoading ? "Analyzing…" : "Analyze"}
              </Button>
            </div>
          )}
        </div>

        {/* Stock header card */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-lg bg-muted text-xs font-bold text-muted-foreground shrink-0">
                  {symbol.slice(0, 4)}
                </div>
                <div>
                  <CardTitle className="text-2xl font-bold">{symbol}</CardTitle>
                  <CardDescription>
                    {[stock?.name, stock?.sector, stock?.industry].filter(Boolean).join(" · ") ||
                      "Stock detail page"}
                  </CardDescription>
                  {latestAnalysis?.cycle && (
                    <div className="mt-2 flex flex-col gap-0.5">
                      <p className="text-xs text-muted-foreground">Cycle conviction</p>
                      <CycleStrengthBar strength={latestAnalysis.cycleStrength} />
                    </div>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0 min-w-[160px]">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Latest update
                </p>
                <p className="text-2xl font-bold tabular-nums mb-1.5">
                  {moneyStr(latestAnalysis?.priceAtAnalysis ?? null)}
                </p>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>Updated: {dateStr(latestAnalysis?.updatedAt, true)}</p>
                  <p>
                    Confidence:{" "}
                    {latestAnalysis?.confidence != null ? `${latestAnalysis.confidence}%` : "—"}
                  </p>
                  <p>{session ? "Signed in" : "Browsing public data"}</p>
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Streaming analysis or saved analysis */}
        {streamState.isLoading || streamState.isComplete || streamState.text ? (
          <StreamingAnalysis state={streamState} saveState={saveState} saveError={saveError} />
        ) : latestAnalysis ? (
          <>
            <SetupChecklist rec={recommendation} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              {/* AI analysis card */}
              <Card>
                <CardHeader>
                  <div>
                    <CardDescription className="text-xs uppercase tracking-wider mb-0.5">
                      AI analysis
                    </CardDescription>
                    <CardTitle className="text-xl">Weekly recommendation</CardTitle>
                  </div>
                  <CardAction>
                    <div className="flex flex-col items-end gap-1.5">
                      <SignalBadge signal={latestAnalysis.signal} />
                      {latestAnalysis.cycle && (
                        <CycleBadge
                          cycle={latestAnalysis.cycle as Cycle}
                          timeframe={latestAnalysis.cycleTimeframe}
                        />
                      )}
                    </div>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        label: "Confidence",
                        value:
                          latestAnalysis.confidence != null ? `${latestAnalysis.confidence}%` : "—",
                      },
                      {
                        label: "Risk",
                        value: recommendation?.riskLevel ?? "—",
                      },
                      {
                        label: "Price target",
                        value: moneyStr(recommendation?.priceTarget),
                      },
                      {
                        label: "Stop loss",
                        value: moneyStr(recommendation?.stopLoss),
                      },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-lg bg-muted/60 px-3 py-3">
                        <p className="text-xs text-muted-foreground mb-1">{label}</p>
                        <p className="text-base font-semibold">{value}</p>
                      </div>
                    ))}
                  </div>

                  {latestAnalysis.cycle && (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                        Cycle phase
                      </p>
                      <div className="flex items-center gap-2 mb-1">
                        <CycleBadge cycle={latestAnalysis.cycle as Cycle} />
                      </div>
                      <CycleStrengthBar strength={latestAnalysis.cycleStrength} />
                      <p className="text-xs text-muted-foreground mt-1">
                        {latestAnalysis.cycleTimeframe === "SHORT" &&
                          "Days to 2 weeks — price action driven"}
                        {latestAnalysis.cycleTimeframe === "MEDIUM" &&
                          "Weeks to a quarter — SMA & earnings driven"}
                        {latestAnalysis.cycleTimeframe === "LONG" &&
                          "Quarters to a year — fundamentals & macro driven"}
                      </p>
                    </div>
                  )}

                  {recommendation?.weeklyOutlook && (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                        Weekly outlook
                      </p>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {recommendation.weeklyOutlook}
                      </p>
                    </div>
                  )}

                  {recommendation?.reasoning && (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                        Reasoning
                      </p>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {recommendation.reasoning}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Bullish / Bearish */}
              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader>
                    <CardDescription className="text-xs uppercase tracking-wider">
                      Bullish factors
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {bullishFactors.length ? (
                      <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc pl-4 leading-relaxed">
                        {bullishFactors.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No bullish factors saved.</p>
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
                    {bearishFactors.length ? (
                      <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc pl-4 leading-relaxed">
                        {bearishFactors.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No bearish factors saved.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        ) : (
          /* No analysis state */
          <Card>
            <CardContent className="flex items-start gap-3 pt-5">
              <CircleAlert className="size-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-1">No analysis generated for {symbol} yet</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Click Analyze above to run a new streaming analysis.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Board of Supervisors ───────────────────────────────────────────── */}
        {(talebAlert || buffettAlert) && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="size-4 text-muted-foreground" />
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Board of supervisors
                </p>
                <h3 className="text-base font-semibold">Independent perspectives</h3>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {talebAlert && (
                <SupervisorCard
                  supervisor="TALEB"
                  alertType={talebAlert.alertType}
                  severity={talebAlert.severity as SupervisorSeverity}
                  title={talebAlert.title}
                  content={talebAlert.content}
                />
              )}
              {buffettAlert && (
                <SupervisorCard
                  supervisor="BUFFETT"
                  alertType={buffettAlert.alertType}
                  severity={buffettAlert.severity as SupervisorSeverity}
                  title={buffettAlert.title}
                  content={buffettAlert.content}
                />
              )}
            </div>
          </section>
        )}

        {/* History + signals */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Analysis history table */}
          <Card className="p-0 overflow-hidden gap-0">
            <CardHeader className="border-b px-5 py-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="size-4 text-muted-foreground" />
                <div>
                  <CardDescription className="text-xs uppercase tracking-wider">
                    History
                  </CardDescription>
                  <CardTitle className="text-base">Recent analysis runs</CardTitle>
                </div>
              </div>
            </CardHeader>
            {data.analysisHistory.length === 0 ? (
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground">No previous analysis runs yet.</p>
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week</TableHead>
                    <TableHead className="text-center">Signal</TableHead>
                    <TableHead className="text-center">Cycle</TableHead>
                    <TableHead className="text-center">Conf.</TableHead>
                    <TableHead className="text-center">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.analysisHistory.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium text-xs">{row.weekStart}</TableCell>
                      <TableCell className="text-center">
                        <SignalBadge signal={row.signal} />
                      </TableCell>
                      <TableCell className="text-center">
                        {row.cycle ? (
                          <CycleBadge cycle={row.cycle as Cycle} />
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground text-xs">
                        {row.confidence != null ? `${row.confidence}%` : "—"}
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {moneyStr(row.priceAtAnalysis)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          {/* Daily signal log */}
          <Card className="p-0 overflow-hidden gap-0">
            <CardHeader className="border-b px-5 py-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-muted-foreground" />
                <div>
                  <CardDescription className="text-xs uppercase tracking-wider">
                    Signals
                  </CardDescription>
                  <CardTitle className="text-base">Daily signal log</CardTitle>
                </div>
              </div>
            </CardHeader>
            {data.dailySignals.length === 0 ? (
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground">
                  No daily signal updates for the latest analysis yet.
                </p>
              </CardContent>
            ) : (
              <div>
                {data.dailySignals.map((row) => (
                  <div key={row.id} className="px-5 py-4 border-b last:border-0">
                    <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                      <span className="text-sm font-medium">{row.date}</span>
                      <div className="flex items-center gap-1.5">
                        <SignalBadge signal={row.signal} />
                        {row.cycle && <CycleBadge cycle={row.cycle as Cycle} />}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <span>Trigger: {row.trigger}</span>
                      <span>Price: {moneyStr(row.priceAtUpdate)}</span>
                      {row.note && <span className="leading-relaxed">{row.note}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
