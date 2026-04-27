import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TrendingUp, Search } from "lucide-react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import {
  getRecentSharedAnalyses,
  getTrackedStocks,
  getMultipleAnalyses,
  getMultipleMetrics,
} from "../server/stocks";
import { DashboardHome, type AnalysisFilter } from "../components/DashboardHome";
import type { StockMetrics } from "../lib/schema";
import { SharedAnalysisTable } from "../components/SharedAnalysisTable";
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
    const analysisSymbols = analyses.map((row) => row.symbol);

    if (!context.session) {
      const metrics = await getMultipleMetrics({
        data: { symbols: uniqueSymbols(analysisSymbols) },
      });
      return { mode: "landing" as const, analyses, metrics };
    }

    const trackedStocks = await getTrackedStocks();
    const trackedSymbols = trackedStocks.map((w) => w.symbol);
    const myAnalyses = await getMultipleAnalyses({ data: { symbols: trackedSymbols } });
    const metrics = await getMultipleMetrics({
      data: { symbols: uniqueSymbols([...trackedSymbols, ...analysisSymbols]) },
    });

    return {
      mode: "dashboard" as const,
      analyses,
      trackedStocks,
      myAnalyses,
      metrics,
    };
  },
  component: HomePage,
});

function WeekLabel() {
  const t = new Date();
  return (
    <span suppressHydrationWarning className="font-medium text-foreground">
      {format(startOfWeek(t, { weekStartsOn: 1 }), "MMM d")} –{" "}
      {format(endOfWeek(t, { weekStartsOn: 1 }), "MMM d, yyyy")}
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
        initialMetrics={data.metrics}
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

  const metricsBySymbol = new Map<string, StockMetrics>(
    data.metrics.map((metric: StockMetrics) => [metric.symbol, metric]),
  );
  const analyses = data.analyses.map((row: any) => ({
    ...row,
    perfDay: metricsBySymbol.get(row.symbol)?.perfDay ?? null,
    perfWtd: metricsBySymbol.get(row.symbol)?.perfWtd ?? null,
    perfMtd: metricsBySymbol.get(row.symbol)?.perfMtd ?? null,
  }));

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Compact app-style header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-5xl mx-auto w-full px-6 h-13 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2 font-semibold text-sm">
            <TrendingUp className="size-4" />
            Bursa
          </div>

          {/* Week indicator */}
          <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
            Week of <WeekLabel />
          </div>

          {/* Quiet sign-in */}
          <Button asChild size="sm" variant="outline">
            <a href="/api/auth/google/start">Sign in with Google</a>
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto w-full px-6 py-8 flex flex-col gap-6">
        {/* Search bar — read-only prompt for guests */}
        <a
          href="/api/auth/google/start"
          className="flex items-center gap-2.5 w-full h-9 px-3 rounded-md border border-border bg-muted text-muted-foreground text-sm hover:border-foreground/30 transition-colors no-underline"
        >
          <Search size={14} className="shrink-0" />
          <span>Search stocks — sign in to save and watch stocks</span>
        </a>

        {/* Shared analysis table — the actual product */}
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold mb-1">Recent shared analyses</h2>
            <p className="text-sm text-muted-foreground">
              Weekly AI analysis shared across all users. Click any row to see the full breakdown.
            </p>
          </div>

          <Card className="p-0">
            {analyses.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <TrendingUp className="size-8 text-muted-foreground/40" />
                <div>
                  <p className="text-sm font-medium mb-1">No shared analyses yet</p>
                  <p className="text-sm text-muted-foreground">
                    Sign in and add a stock to run the first one.
                  </p>
                </div>
              </div>
            ) : (
              <SharedAnalysisTable rows={analyses} />
            )}
          </Card>
        </section>
      </main>
    </div>
  );
}
