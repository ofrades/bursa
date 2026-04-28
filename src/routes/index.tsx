import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";
import { format } from "date-fns";
import {
  getRecentSharedAnalyses,
  getTrackedStocks,
  getMultipleAnalyses,
  getMultipleMetrics,
  refreshMultipleMetrics,
} from "../server/stocks";
import { DashboardHome, type AnalysisFilter } from "../components/DashboardHome";
import type { StockMetrics } from "../lib/schema";
import { SharedAnalysisTable } from "../components/SharedAnalysisTable";
import { StockSearchBar } from "../components/StockSearchBar";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

const FILTER_VALUES = new Set<AnalysisFilter>(["all", "saved", "watching"]);

function uniqueSymbols(symbols: string[]) {
  return Array.from(new Set(symbols));
}

export const Route = createFileRoute("/")({
  validateSearch: (search): { filter?: AnalysisFilter } => ({
    filter:
      typeof search.filter === "string" && FILTER_VALUES.has(search.filter as AnalysisFilter)
        ? (search.filter as AnalysisFilter)
        : undefined,
  }),
  loader: async ({ context }) => {
    const analyses = await getRecentSharedAnalyses();

    if (!context.session) {
      return { mode: "landing" as const, analyses };
    }

    const trackedStocks = await getTrackedStocks();
    const trackedSymbols = trackedStocks.map((w) => w.symbol);
    const myAnalyses = await getMultipleAnalyses({ data: { symbols: trackedSymbols } });

    return {
      mode: "dashboard" as const,
      analyses,
      trackedStocks,
      myAnalyses,
    };
  },
  component: HomePage,
});

function TodayLabel() {
  const t = new Date();
  return (
    <span suppressHydrationWarning className="font-medium text-foreground">
      {format(t, "MMM d, yyyy")}
    </span>
  );
}

function HomePage() {
  const data = Route.useLoaderData() as any;
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { session, walletBalance, isAdmin } = Route.useRouteContext();

  useEffect(() => {
    if (data.mode !== "dashboard" || search.filter) return;
    navigate({
      search: (prev) => ({ ...prev, filter: "watching" }),
      replace: true,
    });
  }, [data.mode, navigate, search.filter]);

  if (data.mode === "dashboard") {
    return (
      <DashboardHome
        session={session}
        walletBalance={walletBalance}
        isAdmin={isAdmin}
        initialTrackedStocks={data.trackedStocks}
        initialAnalyses={data.myAnalyses}
        initialShared={data.analyses}
        filter={search.filter ?? "watching"}
        onFilterChange={(filter) =>
          navigate({
            search: (prev) => ({ ...prev, filter }),
            replace: true,
          })
        }
      />
    );
  }

  return <LandingHome analyses={data.analyses} />;
}

function LandingHome({ analyses: initialAnalyses }: { analyses: any[] }) {
  const [searchQuery, setSearchQuery] = useState("");

  const queryClient = useQueryClient();
  const metricSymbols = useMemo(
    () => uniqueSymbols(initialAnalyses.map((row: any) => row.symbol)),
    [initialAnalyses],
  );
  const metricsKey = metricSymbols.join(",");
  const metricsQuery = useQuery({
    queryKey: ["metrics", metricsKey],
    queryFn: () => getMultipleMetrics({ data: { symbols: metricSymbols } }),
    enabled: metricSymbols.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const refreshMetrics = useCallback(async () => {
    if (!metricSymbols.length) return;
    const refreshed = await refreshMultipleMetrics({ data: { symbols: metricSymbols } });
    queryClient.setQueryData(["metrics", metricsKey], refreshed);
  }, [metricSymbols, metricsKey, queryClient]);

  useEffect(() => {
    void refreshMetrics();
  }, [refreshMetrics]);

  useEffect(() => {
    const handleFocus = () => {
      void refreshMetrics();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshMetrics]);
  const metricsBySymbol = new Map<string, StockMetrics>(
    (metricsQuery.data ?? []).map((metric) => [metric.symbol, metric]),
  );
  const analyses = initialAnalyses.map((row: any) => ({
    ...row,
    perfDay: metricsBySymbol.get(row.symbol)?.perfDay ?? null,
    perfWtd: metricsBySymbol.get(row.symbol)?.perfWtd ?? null,
    perfMtd: metricsBySymbol.get(row.symbol)?.perfMtd ?? null,
  }));
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredAnalyses = useMemo(() => {
    if (!normalizedSearchQuery) return analyses;
    return analyses.filter((row: any) =>
      [row.symbol, row.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearchQuery),
    );
  }, [analyses, normalizedSearchQuery]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-5xl mx-auto w-full px-6 h-13 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <TrendingUp className="size-4" />
            Bursa
          </div>

          <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
            Today <TodayLabel />
          </div>

          <Button asChild size="sm" variant="outline">
            <a href="/api/auth/google/start">Sign in with Google</a>
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto w-full px-6 py-8">
        <section>
          <div className="mb-4">
            <div className="mb-1 text-xs uppercase tracking-[0.08em] text-muted-foreground">
              Stocks
            </div>
            <h2 className="mb-1 text-2xl font-bold">Recent shared analyses</h2>
            <p className="text-sm text-muted-foreground">
              Browse the shared stock table now, then sign in when you want to save or watch names.
            </p>
          </div>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-4 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1 lg:max-w-xl">
                  <StockSearchBar
                    query={searchQuery}
                    onQueryChange={setSearchQuery}
                    existingSymbols={analyses.map((row: any) => row.symbol)}
                    mode="guest"
                    maxWidth="100%"
                    placeholder="Filter the stock table…"
                  />
                  <div className="mt-2 min-h-4 text-xs text-muted-foreground">
                    {metricsQuery.isLoading
                      ? "Loading market snapshots…"
                      : metricsQuery.isFetching
                        ? "Refreshing market snapshots…"
                        : null}
                  </div>
                </div>

                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <a href="/api/auth/google/start">Sign in with Google</a>
                </Button>
              </div>
            </div>

            {filteredAnalyses.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <TrendingUp className="size-8 text-muted-foreground/40" />
                <div>
                  <p className="mb-1 text-sm font-medium">
                    {normalizedSearchQuery
                      ? `No stocks match “${searchQuery.trim()}”`
                      : "No shared analyses yet"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {normalizedSearchQuery
                      ? "Try another symbol or company name."
                      : "Sign in and add a stock to run the first one."}
                  </p>
                </div>
              </div>
            ) : (
              <SharedAnalysisTable rows={filteredAnalyses} />
            )}
          </Card>
        </section>
      </main>
    </div>
  );
}
