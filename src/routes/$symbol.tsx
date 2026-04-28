import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { BarChart3, ChevronLeft, CircleAlert, Loader2, Sparkles, ShieldAlert } from "lucide-react";
import { Badge, SignalBadge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardAction,
} from "../components/ui/card";
import { getStockPageData } from "../server/stocks";
import { isAnalysisRunning } from "../server/active-analyses";
import { useStreamingAnalysis } from "../hooks/useStreamingAnalysis";
import { analysisStreamStore } from "../lib/analysis-stream-store";
import { StreamingAnalysis } from "../components/StreamingAnalysis";
import { JsonSpecRenderer, buildMacroThesisSpec } from "../lib/json-render";
import { buildSimpleAnalysisSpec } from "../lib/simple-analysis-spec";
import { parseMacroThesis } from "../lib/simple-analysis";

export const Route = createFileRoute("/$symbol")({
  validateSearch: (search): { analyze?: boolean } => ({
    analyze:
      search.analyze === true ||
      search.analyze === "true" ||
      search.analyze === 1 ||
      search.analyze === "1"
        ? true
        : undefined,
  }),
  loader: async ({ params }) => {
    const symbol = params.symbol.toUpperCase();
    const [pageData] = await Promise.all([getStockPageData({ data: { symbol } })]);
    return { ...pageData, isAnalyzing: isAnalysisRunning(symbol) };
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

function weekRangeStr(start: string | null | undefined, end: string | null | undefined) {
  if (!start) return "—";
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : null;

  if (Number.isNaN(startDate.getTime())) return start;
  if (!endDate || Number.isNaN(endDate.getTime())) return dateStr(startDate);

  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const startLabel = startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endLabel = endDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${startLabel} – ${endLabel}`;
}

function confidenceTone(confidence: number | null | undefined) {
  if (confidence == null) return "bg-muted";
  if (confidence >= 75) return "bg-emerald-500";
  if (confidence >= 55) return "bg-amber-400";
  return "bg-red-400";
}

function confidenceLabel(confidence: number | null | undefined) {
  if (confidence == null) return "Unknown";
  if (confidence >= 75) return "High";
  if (confidence >= 55) return "Medium";
  return "Low";
}

function StockPage() {
  const data = Route.useLoaderData();
  const params = Route.useParams();
  const search = Route.useSearch();
  const { session } = Route.useRouteContext();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const symbol = params.symbol.toUpperCase();

  // If a server-side analysis is running (e.g. after a page refresh), poll
  // every 4 s until it finishes and the loader data includes the saved result.
  useEffect(() => {
    if (!data.isAnalyzing) return;
    const id = setInterval(() => {
      void router.invalidate();
    }, 4_000);
    return () => clearInterval(id);
  }, [data.isAnalyzing, router]);

  const { state: streamState, start: startStream } = useStreamingAnalysis(symbol);

  const handleAnalyze = () => {
    startStream();
  };

  useEffect(() => {
    if (!search.analyze || !session || streamState.isLoading) return;

    navigate({
      search: (prev) => ({ ...prev, analyze: undefined }),
      replace: true,
    });
    handleAnalyze();
  }, [handleAnalyze, navigate, search.analyze, session, streamState.isLoading]);

  // Reload page data when the server signals the analysis has been persisted,
  // then clear the store so the saved analysis view takes over.
  useEffect(() => {
    if (!streamState.analysisSaved) return;
    void router.invalidate().then(() => {
      analysisStreamStore.clear(symbol);
    });
  }, [streamState.analysisSaved, router, symbol]);
  const stock = data.stock;
  const latestAnalysis = data.latestAnalysis;
  const recommendation = parseRecommendation(latestAnalysis?.reasoning);
  const bullishFactors = recommendation?.keyBullishFactors ?? [];
  const bearishFactors = recommendation?.keyBearishFactors ?? [];
  const alerts = data.supervisorAlerts ?? [];
  const hasExtreme = alerts.some((a) => a.severity === "EXTREME");
  const simpleAnalysisSpec = data.simpleAnalysis
    ? buildSimpleAnalysisSpec(data.simpleAnalysis)
    : null;
  const persistedMacroThesis = parseMacroThesis(latestAnalysis?.macroThesisJson ?? null);
  const macroThesisSpec = persistedMacroThesis ? buildMacroThesisSpec(persistedMacroThesis) : null;

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
                disabled={streamState.isLoading || data.isAnalyzing}
                onClick={handleAnalyze}
              >
                {streamState.isLoading || data.isAnalyzing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {streamState.isLoading || data.isAnalyzing ? "Analyzing…" : "Analyze"}
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
          <StreamingAnalysis state={streamState} />
        ) : data.isAnalyzing ? (
          <Card>
            <CardContent className="flex items-center gap-3 pt-5">
              <Loader2 className="size-5 animate-spin text-muted-foreground shrink-0" />
              <div>
                <p className="font-semibold mb-1">Analysis in progress</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Analysing {symbol} in the background. The page will update automatically when
                  done.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : latestAnalysis ? (
          <>
            {macroThesisSpec && <JsonSpecRenderer spec={macroThesisSpec} />}

            {simpleAnalysisSpec && <JsonSpecRenderer spec={simpleAnalysisSpec} />}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <Card>
                <CardHeader>
                  <div>
                    <CardDescription className="text-xs uppercase tracking-wider mb-0.5">
                      Near-term read
                    </CardDescription>
                    <CardTitle className="text-xl">This week&apos;s setup</CardTitle>
                  </div>
                  <CardAction>
                    <SignalBadge signal={latestAnalysis.signal} />
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

                  {recommendation?.weeklyOutlook && (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                        Short summary
                      </p>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {recommendation.weeklyOutlook}
                      </p>
                    </div>
                  )}

                  {recommendation?.reasoning && (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                        Why the model thinks that
                      </p>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {recommendation.reasoning}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader>
                    <CardDescription className="text-xs uppercase tracking-wider">
                      What helps
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
                      <p className="text-sm text-muted-foreground">No clear helpers saved yet.</p>
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
                    {bearishFactors.length ? (
                      <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc pl-4 leading-relaxed">
                        {bearishFactors.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No clear watch-outs saved yet.
                      </p>
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

        {/* History */}
        <Card className="p-0 overflow-hidden gap-0">
          <CardHeader className="border-b px-5 py-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <BarChart3 className="size-4 text-muted-foreground" />
                <div>
                  <CardDescription className="text-xs uppercase tracking-wider">
                    History
                  </CardDescription>
                  <CardTitle className="text-base">Analysis timeline</CardTitle>
                </div>
              </div>
              <Badge variant="outline">{data.analysisHistory.length} runs</Badge>
            </div>
          </CardHeader>
          {data.analysisHistory.length === 0 ? (
            <CardContent className="py-6">
              <p className="text-sm text-muted-foreground">No previous analysis runs yet.</p>
            </CardContent>
          ) : (
            <CardContent className="px-0 py-0">
              <div>
                {data.analysisHistory.map((row, index) => {
                  const isLatest = index === 0;
                  return (
                    <div
                      key={row.id}
                      className="border-b last:border-b-0 px-5 py-4 transition-colors hover:bg-muted/30"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-foreground">
                              {weekRangeStr(row.weekStart, row.weekEnd)}
                            </p>
                            {isLatest && <Badge variant="secondary">Latest</Badge>}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Updated {dateStr(row.updatedAt, true)}
                          </p>
                        </div>
                        <SignalBadge signal={row.signal} />
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="rounded-lg bg-muted/50 px-3 py-3">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">Confidence</span>
                            <span className="text-xs font-medium text-foreground">
                              {row.confidence != null
                                ? `${Math.round(row.confidence)}% · ${confidenceLabel(row.confidence)}`
                                : "—"}
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-background">
                            <div
                              className={`h-full rounded-full ${confidenceTone(row.confidence)}`}
                              style={{
                                width: `${Math.max(0, Math.min(100, row.confidence ?? 0))}%`,
                              }}
                            />
                          </div>
                        </div>

                        <div className="rounded-lg bg-muted/50 px-3 py-3">
                          <p className="text-xs text-muted-foreground">Price at review</p>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {moneyStr(row.priceAtAnalysis)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
