import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { BarChart3, ChevronLeft, CircleAlert, Loader2, Sparkles } from "lucide-react";
import { Badge, LongTermBadge, SignalBadge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import {
  getStockPageData,
  getStockPageSupplementalData,
  getStockDividendData,
} from "../server/stocks";
import { isAnalysisRunning } from "../server/active-analyses";
import { useStreamingAnalysis } from "../hooks/useStreamingAnalysis";
import { StreamingAnalysis } from "../components/StreamingAnalysis";
import { StockThesisCard } from "../components/StockThesisCard";
import { JsonSpecRenderer, buildMacroThesisSpec } from "../lib/json-render";
import { buildSimpleAnalysisSpec } from "../lib/simple-analysis-spec";
import { parseMacroThesis } from "../lib/simple-analysis";
import { parseStockThesis } from "../lib/stock-thesis";
import {
  getLongTermRecommendation,
  getWeeklyRecommendationDisplay,
} from "../lib/recommendation-labels";
import { buildAnalysisDiff } from "../lib/analysis-diff";
import { normalizeScore } from "../lib/analysis-normalize";
import {
  deriveStockPageState,
  parseRecommendation,
  moneyStr,
  dateStr,
  analysisDateStr,
  confidenceTone,
  confidenceLabel,
} from "../lib/stock-page-helpers";
import { DividendCard } from "../components/DividendCard";
import { AnalysisAuditCard } from "../components/AnalysisAuditCard";

export const Route = createFileRoute("/$symbol")({
  validateSearch: (search) =>
    search.analyze === true ||
    search.analyze === "true" ||
    search.analyze === 1 ||
    search.analyze === "1"
      ? { analyze: true }
      : {},
  loader: async ({ params }) => {
    const symbol = params.symbol.toUpperCase();
    const pageData = await getStockPageData({ data: { symbol } });
    return { ...pageData, isAnalyzing: isAnalysisRunning(symbol) };
  },
  component: StockPage,
});

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

  const {
    state: streamState,
    start: startStream,
    reset: resetStream,
  } = useStreamingAnalysis(symbol);

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
      resetStream();
    });
  }, [resetStream, streamState.analysisSaved, router, symbol]);
  const supplementalQuery = useQuery({
    queryKey: ["stock-supplemental", symbol, data.latestAnalysis?.id ?? "none"],
    queryFn: () => getStockPageSupplementalData({ data: { symbol } }),
    enabled: !data.simpleAnalysis,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const dividendQuery = useQuery({
    queryKey: ["stock-dividend", symbol],
    queryFn: () => getStockDividendData({ data: { symbol } }),
    staleTime: 60 * 60_000, // 1 hour — dividends don't change often
    refetchOnWindowFocus: false,
  });

  const stock = data.stock;
  const latestAnalysis = data.latestAnalysis;
  const simpleAnalysisEvidence = supplementalQuery.data?.simpleAnalysis ?? data.simpleAnalysis;
  const simpleAnalysisSpec = simpleAnalysisEvidence
    ? buildSimpleAnalysisSpec(simpleAnalysisEvidence)
    : null;
  const {
    recommendation,
    weeklyRecommendation,
    persistedMacroThesis,
    effectiveThesis,
    longTermRecommendation,
  } = deriveStockPageState(latestAnalysis, simpleAnalysisEvidence);
  const macroThesisSpec = persistedMacroThesis ? buildMacroThesisSpec(persistedMacroThesis) : null;
  const hasStreamingAnalysis =
    streamState.isLoading || streamState.isComplete || Boolean(streamState.text);

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
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="size-3 text-muted-foreground" />
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Weekly
                  </span>
                  <SignalBadge signal={weeklyRecommendation.value} />
                </div>
                {longTermRecommendation ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Long term
                    </span>
                    <LongTermBadge stance={longTermRecommendation.value} />
                  </div>
                ) : null}
              </div>
            ) : (
              <Badge variant="outline">No analysis yet</Badge>
            )}
          </div>
          {session && (
            <div className="flex items-center gap-2">
              {(streamState.error || streamState.warning) && (
                <span
                  className="max-w-md text-xs text-red-500"
                  title={
                    streamState.chunksBeforeError != null
                      ? `Stream died after ${streamState.chunksBeforeError} chunks / ${streamState.elapsedBeforeError?.toFixed(1)}s`
                      : undefined
                  }
                >
                  {streamState.error ?? streamState.warning}
                </span>
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
                  <p>{session ? "Signed in" : "Browsing public data"}</p>
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Metrics section — fundamentals (KPI grid / charts / CAGR / balance
            sheet) plus the dividends subsection. Both live under one
            "Metrics" header so the page reads as a single fundamentals block.
            The fundamentals part is hidden during streaming/analysis (the
            streaming card has its own copy of the fundamentals). */}
        {!hasStreamingAnalysis &&
          !data.isAnalyzing &&
          (simpleAnalysisSpec || supplementalQuery.isLoading || dividendQuery.data) && (
            <section aria-label="Metrics" className="flex flex-col gap-4">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Metrics</h2>
              {!streamState.isLoading &&
                !streamState.isComplete &&
                !streamState.text &&
                !data.isAnalyzing &&
                (simpleAnalysisSpec ? (
                  <JsonSpecRenderer spec={simpleAnalysisSpec} />
                ) : supplementalQuery.isLoading ? (
                  <Card>
                    <CardContent className="flex items-center gap-3 pt-5">
                      <Loader2 className="size-5 animate-spin text-muted-foreground shrink-0" />
                      <div>
                        <p className="font-semibold mb-1">Loading fundamentals</p>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Pulling sales, cash, and growth data for {symbol}.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ) : null)}
              {dividendQuery.data && <DividendCard data={dividendQuery.data} />}
            </section>
          )}

        {/* Streaming analysis or saved analysis */}
        {hasStreamingAnalysis ? (
          <StreamingAnalysis
            state={streamState}
            simpleAnalysis={simpleAnalysisEvidence}
            dividendData={dividendQuery.data ?? null}
          />
        ) : latestAnalysis && !data.isAnalyzing ? (
          <section aria-label="Thesis" className="flex flex-col gap-4">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Thesis</h2>

            {/* "Why" — the only unique content from the old "What to do this
                week" card that wasn't already covered by the StockThesisCard
                pillars / summary / supports / limits. */}
            {recommendation?.reasoning ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs uppercase tracking-wider">
                    Why this read
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {recommendation.reasoning}
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {effectiveThesis && <StockThesisCard thesis={effectiveThesis} />}

            {macroThesisSpec && <JsonSpecRenderer spec={macroThesisSpec} />}
          </section>
        ) : !data.isAnalyzing ? (
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
        ) : null}

        {/* History section: the "What changed" card followed by the analysis timeline. */}
        {data.analysisHistory.length > 0 && (
          <section aria-label="History" className="flex flex-col gap-4">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground">History</h2>
            {!streamState.isLoading &&
              !streamState.isComplete &&
              !streamState.text &&
              !data.isAnalyzing &&
              data.analysisHistory.length >= 2 && (
                <AnalysisAuditCard
                  diff={buildAnalysisDiff(data.analysisHistory[0], data.analysisHistory[1])}
                />
              )}
            <Card className="p-0 overflow-hidden gap-0">
              <CardHeader className="border-b px-5 py-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="size-4 text-muted-foreground" />
                    <CardTitle className="text-base">Analysis timeline</CardTitle>
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
                      const rowThesis = parseStockThesis(row.thesisJson ?? null);
                      const rowMacroThesis = parseMacroThesis(row.macroThesisJson ?? null);
                      const rowLongTerm = getLongTermRecommendation(rowThesis, rowMacroThesis);
                      const rowWeekly = getWeeklyRecommendationDisplay(
                        row.reasoning ?? null,
                        row.signal,
                        row.confidence,
                      );
                      const rowRec = parseRecommendation(row.reasoning ?? null);
                      return (
                        <div
                          key={row.id}
                          className="border-b last:border-b-0 px-5 py-4 transition-colors hover:bg-muted/30"
                        >
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-foreground">
                                  {analysisDateStr(row.analysisDate)}
                                </p>
                                {isLatest && <Badge variant="secondary">Latest</Badge>}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Updated {dateStr(row.updatedAt, true)}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                  Weekly
                                </span>
                                <SignalBadge signal={rowWeekly.value} />
                              </div>
                              {rowLongTerm ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                    Long term
                                  </span>
                                  <LongTermBadge stance={rowLongTerm.value} />
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="rounded-lg bg-muted/50 px-3 py-3">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="text-xs text-muted-foreground">Confidence</span>
                                <span className="text-xs font-medium text-foreground">
                                  {normalizeScore(row.confidence) != null
                                    ? `${normalizeScore(row.confidence)}% · ${confidenceLabel(normalizeScore(row.confidence))}`
                                    : "—"}
                                </span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-background">
                                <div
                                  className={`h-full rounded-full ${confidenceTone(normalizeScore(row.confidence))}`}
                                  style={{
                                    width: `${normalizeScore(row.confidence) ?? 0}%`,
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

                          {rowRec?.weeklyOutlook && (
                            <p className="mt-3 text-xs text-muted-foreground leading-relaxed line-clamp-2">
                              {rowRec.weeklyOutlook}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              )}
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
