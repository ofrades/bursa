import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles, TrendingUp, Users, X } from "lucide-react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { Bar, BarChart, Cell, ReferenceLine, XAxis } from "recharts";
import {
  getWatchlist,
  removeFromWatchlist,
  getMultipleAnalyses,
  getMultipleMetrics,
  getRecentSharedAnalyses,
} from "../server/stocks";
import { generateWeeklyAnalysis } from "../server/recommend";
import { getSession } from "../server/session";
import type { StockAnalysis, StockMetrics } from "../lib/schema";
import { StockSearchBar } from "./StockSearchBar";
import { Badge, SignalBadge, type Signal } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "./ui/card";
import { ChartContainer, type ChartConfig } from "./ui/chart";
import { SharedAnalysisTable } from "./SharedAnalysisTable";

type SharedRow = {
  symbol: string;
  signal: string;
  confidence: number | null;
  updatedAt: Date | null;
  name: string | null;
  perfWtd: number | null;
  perfMtd: number | null;
  perfYtd: number | null;
  nextEarningsDate: string | null;
};

type Props = {
  session: { sub: string; image?: string | null } | null;
  analysisCredits: number;
  isAdmin: boolean;
  initialWatchlist: Array<{
    symbol: string;
    name: string | null;
    exchange: string | null;
  }>;
  initialAnalyses: StockAnalysis[];
  initialMetrics: StockMetrics[];
  initialShared: SharedRow[];
};

function pctColor(v: number | null | undefined) {
  if (v == null) return "hsl(var(--muted-foreground))";
  return v > 0 ? "hsl(var(--chart-2))" : v < 0 ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))";
}
function pctStr(v: number | null | undefined) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

const perfChartConfig = {
  value: { label: "Performance" },
} satisfies ChartConfig;

function PerfMiniChart({ wtd, mtd, ytd }: { wtd?: number | null; mtd?: number | null; ytd?: number | null }) {
  const data = [
    { name: "WTD", value: wtd ?? 0 },
    { name: "MTD", value: mtd ?? 0 },
    { name: "YTD", value: ytd ?? 0 },
  ];
  return (
    <ChartContainer config={perfChartConfig} className="h-12 w-full">
      <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <ReferenceLine y={0} stroke="hsl(var(--border))" />
        <Bar dataKey="value" radius={[2, 2, 0, 0]} maxBarSize={18}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.value > 0 ? "hsl(var(--chart-2))" : entry.value < 0 ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))"} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
function WeekLabel() {
  const t = new Date();
  return (
    <span suppressHydrationWarning className="font-medium text-foreground">
      {format(startOfWeek(t, { weekStartsOn: 1 }), "MMM d")} –{" "}
      {format(endOfWeek(t, { weekStartsOn: 1 }), "MMM d, yyyy")}
    </span>
  );
}

export function DashboardHome({
  session,
  analysisCredits,
  isAdmin,
  initialWatchlist,
  initialAnalyses,
  initialMetrics,
  initialShared,
}: Props) {
  const [watchlist, setWatchlist] = useState(initialWatchlist);
  const [analyses, setAnalyses] = useState<StockAnalysis[]>(initialAnalyses);
  const [metrics, setMetrics] = useState<StockMetrics[]>(initialMetrics);
  const [shared, setShared] = useState<SharedRow[]>(initialShared);
  const [credits, setCredits] = useState(analysisCredits);
  const [showCreditsToast, setShowCreditsToast] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analysisToast, setAnalysisToast] = useState<{
    title: string;
    body: string;
    tone: "success" | "danger";
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("credits") === "1") {
      setShowCreditsToast(true);
      url.searchParams.delete("credits");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const reload = useCallback(async () => {
    const wl = await getWatchlist();
    const syms = wl.map((w) => w.symbol);
    const [newAnalyses, newMetrics, newShared, freshSession] =
      await Promise.all([
        getMultipleAnalyses({ data: { symbols: syms } }),
        getMultipleMetrics({ data: { symbols: syms } }),
        getRecentSharedAnalyses(),
        getSession(),
      ]);
    setWatchlist(wl);
    setAnalyses(newAnalyses);
    setMetrics(newMetrics);
    setShared(newShared);
    setCredits(freshSession?.analysisCredits ?? 0);
  }, []);

  const signOut = () =>
    fetch("/api/auth/signout", { method: "POST" }).then(() => {
      window.location.href = "/";
    });
  const startCheckout = async () => {
    const res = await fetch("/api/billing/checkout", { method: "POST" });
    const { url } = await res.json();
    if (url) window.location.href = url;
  };
  const handleRemove = async (symbol: string) => {
    setRemoving(symbol);
    try {
      await removeFromWatchlist({ data: { symbol } });
      await reload();
    } finally {
      setRemoving(null);
    }
  };
  const handleAnalyze = async (symbol: string) => {
    setAnalyzing(symbol);
    setAnalysisToast(null);
    try {
      await generateWeeklyAnalysis({ data: { symbol } });
      await reload();
      setAnalysisToast({
        title: `${symbol} analyzed`,
        body: isAdmin
          ? "The latest weekly analysis is ready."
          : "The latest weekly analysis is ready and your credits were updated.",
        tone: "success",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Analysis failed";
      if (message === "CREDITS_REQUIRED") {
        setAnalysisToast({
          title: "Not enough credits",
          body: "You need at least 1 credit to run a new analysis.",
          tone: "danger",
        });
        return;
      }
      setAnalysisToast({
        title: "Analysis failed",
        body: message,
        tone: "danger",
      });
    } finally {
      setAnalyzing(null);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-5xl mx-auto w-full px-6 h-13 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <TrendingUp className="size-4" />
            Bursa
          </div>
          <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
            Week of <WeekLabel />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {session?.image && (
              <img
                src={session.image}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  border: "2px solid var(--border)",
                }}
              />
            )}
            {isAdmin ? (
              <Badge
                variant="outline"
                className="text-[var(--brand)] border-[var(--brand)]/30"
              >
                Admin
              </Badge>
            ) : (
              <>
                <Badge variant="outline">{credits ?? 0} credits</Badge>
                <Button size="sm" onClick={startCheckout}>
                  Buy 10 credits
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {!isAdmin && (
        <div
          style={{
            background: "var(--bg-muted)",
            borderBottom: "1px solid var(--border)",
            padding: "10px 24px",
          }}
        >
          <div className="max-w-5xl mx-auto w-full px-6 flex items-center justify-between flex-wrap gap-2">
            <div style={{ fontSize: 13, color: "var(--fg-muted)" }}>
              <strong style={{ color: "var(--fg)" }}>Credits:</strong>{" "}
              {credits ?? 0} — add stocks and view shared analyses. Each
              analysis costs 1 credit. Buy 10 credits for €1.
            </div>
            <Button size="sm" onClick={startCheckout}>
              Buy credits →
            </Button>
          </div>
        </div>
      )}

      {showCreditsToast && (
        <div
          style={{
            position: "fixed",
            right: 16,
            top: 68,
            zIndex: 60,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-lg)",
            borderRadius: 12,
            padding: "12px 14px",
            maxWidth: 280,
          }}
        >
          <div style={{ display: "flex", alignItems: "start", gap: 10 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--brand)",
                marginTop: 4,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                Credits added
              </div>
              <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                Your purchase completed. Credits are ready to use.
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowCreditsToast(false)}
            >
              <X size={12} />
            </Button>
          </div>
        </div>
      )}

      {analysisToast && (
        <div
          style={{
            position: "fixed",
            right: 16,
            top: showCreditsToast ? 164 : 68,
            zIndex: 60,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-lg)",
            borderRadius: 12,
            padding: "12px 14px",
            maxWidth: 320,
          }}
        >
          <div style={{ display: "flex", alignItems: "start", gap: 10 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background:
                  analysisToast.tone === "success"
                    ? "var(--brand)"
                    : "var(--danger)",
                marginTop: 4,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                {analysisToast.title}
              </div>
              <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                {analysisToast.body}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setAnalysisToast(null)}
            >
              <X size={12} />
            </Button>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto w-full px-6 py-6">
        <div style={{ marginBottom: 24 }}>
          <StockSearchBar
            onAdded={reload}
            watchlistSymbols={watchlist.map((w) => w.symbol)}
          />
        </div>

        <section style={{ marginBottom: 40 }}>
          <div
            style={{
              display: "flex",
              alignItems: "end",
              justifyContent: "space-between",
              gap: 16,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--fg-subtle)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                User stocks
              </div>
              <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
                Your saved stocks
              </h2>
              <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>
                These are your personal saved stocks. Click a card to open its
                detail page.
              </p>
            </div>
          </div>

          {watchlist.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
              <TrendingUp className="size-8 text-muted-foreground/40" />
              <p className="font-medium">Your watchlist is empty</p>
              <p className="text-sm">Search above to add stocks.</p>
            </Card>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
              {watchlist.map(({ symbol, name }) => {
                const analysis = analyses.find((a) => a.symbol === symbol);
                const m = metrics.find((x) => x.symbol === symbol);
                const sharedByCommunity = Boolean(
                  analysis?.lastTriggeredByUserId &&
                  analysis.lastTriggeredByUserId !== session?.sub,
                );
                return (
                  <Link
                    key={symbol}
                    to="/$symbol"
                    params={{ symbol }}
                    className="block no-underline"
                  >
                    <Card className="cursor-pointer transition-colors hover:bg-muted/40 h-full">
                      <CardHeader className="flex flex-row items-start justify-between gap-2 p-3 pb-2">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-sm leading-none">{symbol}</span>
                            {analysis ? (
                              <SignalBadge signal={analysis.signal as Signal} />
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0 h-4">No analysis</Badge>
                            )}
                            {sharedByCommunity && (
                              <Badge variant="outline" className="text-[10px] py-0 h-4 gap-0.5">
                                <Users className="size-2.5" /> community
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground truncate max-w-[160px]">{name ?? "—"}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 -mt-0.5"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRemove(symbol);
                          }}
                        >
                          {removing === symbol ? (
                            <Loader2 className="spin" />
                          ) : (
                            <X />
                          )}
                        </Button>
                      </CardHeader>

                      <CardContent className="px-3 pb-3 pt-0 flex flex-col gap-2">
                        {/* Mini performance chart */}
                        <PerfMiniChart wtd={m?.perfWtd} mtd={m?.perfMtd} ytd={m?.perfYtd} />

                        {/* Perf values row */}
                        <div className="grid grid-cols-3 gap-1 text-center">
                          {(["WTD", "MTD", "YTD"] as const).map((label, i) => {
                            const val = [m?.perfWtd, m?.perfMtd, m?.perfYtd][i];
                            return (
                              <div key={label} className="flex flex-col gap-0.5">
                                <span className="text-[10px] text-muted-foreground">{label}</span>
                                <span className="text-xs font-semibold" style={{ color: pctColor(val) }}>
                                  {pctStr(val)}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Analyze button */}
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full h-7 text-xs mt-0.5"
                          disabled={analyzing === symbol || removing === symbol}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleAnalyze(symbol);
                          }}
                        >
                          {analyzing === symbol ? (
                            <Loader2 data-icon="inline-start" className="spin" />
                          ) : (
                            <Sparkles data-icon="inline-start" />
                          )}
                          {analyzing === symbol
                            ? "Analyzing…"
                            : analysis
                              ? "Refresh"
                              : "Run analysis"}
                          {!isAdmin && !analyzing && (
                            <span className="ml-auto text-muted-foreground text-[10px]">1 cr</span>
                          )}
                        </Button>

                        {analysis?.updatedAt && (
                          <p className="text-[10px] text-muted-foreground text-center -mt-1">
                            Updated {new Date(analysis.updatedAt).toLocaleDateString()}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <div
            style={{
              display: "flex",
              alignItems: "end",
              justifyContent: "space-between",
              gap: 16,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--fg-subtle)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                Shared table
              </div>
              <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
                Recent community analysis
              </h2>
              <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>
                Global shared analysis across the platform. Click a row to open
                its detail page.
              </p>
            </div>
          </div>

          <Card className="overflow-hidden p-0">
            {shared.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  color: "var(--fg-muted)",
                  textAlign: "center",
                }}
              >
                No shared analysis yet.
              </div>
            ) : (
              <SharedAnalysisTable rows={shared} />
            )}
          </Card>
        </section>
      </main>

      <style>{`.spin { animation: spin 1s linear infinite } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
