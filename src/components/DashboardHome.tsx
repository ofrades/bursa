import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, X } from "lucide-react";
import { format } from "date-fns";
import {
  getTrackedStocks,
  saveStock,
  unsaveStock,
  watchStock,
  unwatchStock,
  getMultipleAnalyses,
  getMultipleMetrics,
  getRecentSharedAnalyses,
  refreshMultipleMetrics,
} from "../server/stocks";
import { getSession } from "../server/session";
import type { StockAnalysis } from "../lib/schema";
import { StockSearchBar } from "./StockSearchBar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { SharedAnalysisTable } from "./SharedAnalysisTable";

type SharedRow = {
  symbol: string;
  signal: string;
  confidence: number | null;
  updatedAt: Date | null;
  reasoning?: string | null;
  thesisJson?: string | null;
  macroThesisJson?: string | null;
  name: string | null;
  perfDay?: number | null;
  perfWtd?: number | null;
  perfMtd?: number | null;
};

type TrackedStock = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  isSaved: boolean;
  isWatching: boolean;
};

export type AnalysisFilter = "all" | "saved" | "watching";

type Props = {
  session: { sub: string; image?: string | null } | null;
  walletBalance: number;
  isAdmin: boolean;
  initialTrackedStocks: TrackedStock[];
  initialAnalyses: StockAnalysis[];
  initialShared: SharedRow[];
  filter: AnalysisFilter;
  onFilterChange: (filter: AnalysisFilter) => void;
};

function formatEuro(cents: number): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function TodayLabel() {
  const t = new Date();
  return (
    <span suppressHydrationWarning className="font-medium text-foreground">
      {format(t, "MMM d, yyyy")}
    </span>
  );
}

export function DashboardHome({
  session,
  walletBalance,
  isAdmin,
  initialTrackedStocks,
  initialAnalyses,
  initialShared,
  filter,
  onFilterChange,
}: Props) {
  const [trackedStocks, setTrackedStocks] = useState(initialTrackedStocks);
  const [analyses, setAnalyses] = useState<StockAnalysis[]>(initialAnalyses);
  const [shared, setShared] = useState<SharedRow[]>(initialShared);
  const [balance, setBalance] = useState(walletBalance);
  const [showTopupToast, setShowTopupToast] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState<string>("1");
  const [searchQuery, setSearchQuery] = useState("");

  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("topup") === "1") {
      setShowTopupToast(true);
      url.searchParams.delete("topup");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const metricSymbols = useMemo(
    () =>
      Array.from(
        new Set([...trackedStocks.map((w) => w.symbol), ...shared.map((row) => row.symbol)]),
      ),
    [shared, trackedStocks],
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

  const metrics = metricsQuery.data ?? [];

  const reload = useCallback(async () => {
    const wl = await getTrackedStocks();
    const trackedSymbols = wl.map((w) => w.symbol);
    const [newAnalyses, newShared, freshSession] = await Promise.all([
      getMultipleAnalyses({ data: { symbols: trackedSymbols } }),
      getRecentSharedAnalyses(),
      getSession(),
    ]);
    setTrackedStocks(wl);
    setAnalyses(newAnalyses);
    setShared(newShared);
    setBalance(freshSession?.walletBalance ?? 0);
    void queryClient.invalidateQueries({ queryKey: ["metrics"] });
  }, [queryClient]);

  const signOut = () =>
    fetch("/api/auth/signout", { method: "POST" }).then(() => {
      window.location.href = "/";
    });
  const startCheckout = async () => {
    const amount = Math.max(1, Math.min(100, parseInt(topupAmount, 10) || 1));
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountEur: amount }),
    });
    const { url } = await res.json();
    if (url) window.location.href = url;
  };
  const handleToggleSave = async (row: {
    symbol: string;
    isSaved?: boolean;
    isWatching?: boolean;
  }) => {
    setToggling(`save:${row.symbol}`);
    try {
      if (row.isWatching) {
        await unwatchStock({ data: { symbol: row.symbol } });
      } else if (row.isSaved) {
        await unsaveStock({ data: { symbol: row.symbol } });
      } else {
        const name =
          trackedStocks.find((w) => w.symbol === row.symbol)?.name ??
          shared.find((s) => s.symbol === row.symbol)?.name ??
          undefined;
        const exchange = trackedStocks.find((w) => w.symbol === row.symbol)?.exchange ?? undefined;
        await saveStock({ data: { symbol: row.symbol, name, exchange } });
      }
      await reload();
    } finally {
      setToggling(null);
    }
  };

  const handleToggleWatch = async (row: {
    symbol: string;
    isSaved?: boolean;
    isWatching?: boolean;
  }) => {
    setToggling(`watch:${row.symbol}`);
    try {
      if (row.isWatching) {
        await unwatchStock({ data: { symbol: row.symbol } });
      } else {
        const name =
          trackedStocks.find((w) => w.symbol === row.symbol)?.name ??
          shared.find((s) => s.symbol === row.symbol)?.name ??
          undefined;
        const exchange = trackedStocks.find((w) => w.symbol === row.symbol)?.exchange ?? undefined;
        await watchStock({ data: { symbol: row.symbol, name, exchange } });
      }
      await reload();
    } finally {
      setToggling(null);
    }
  };

  const rows = useMemo(() => {
    const trackedBySymbol = new Map(trackedStocks.map((item) => [item.symbol, item]));
    const analysisBySymbol = new Map(analyses.map((item) => [item.symbol, item]));
    const metricsBySymbol = new Map(metrics.map((item) => [item.symbol, item]));
    const map = new Map<string, SharedRow & { isSaved: boolean; isWatching: boolean }>();

    for (const w of trackedStocks) {
      const a = analysisBySymbol.get(w.symbol);
      const metric = metricsBySymbol.get(w.symbol);
      map.set(w.symbol, {
        symbol: w.symbol,
        name: w.name ?? null,
        signal: a?.signal ?? "HOLD",
        confidence: a?.confidence ?? null,
        updatedAt: a?.updatedAt ?? null,
        reasoning: a?.reasoning ?? null,
        thesisJson: a?.thesisJson ?? null,
        macroThesisJson: a?.macroThesisJson ?? null,
        perfDay: metric?.perfDay ?? null,
        perfWtd: metric?.perfWtd ?? null,
        perfMtd: metric?.perfMtd ?? null,
        isSaved: w.isSaved,
        isWatching: w.isWatching,
      });
    }

    for (const s of shared) {
      if (map.has(s.symbol)) continue;
      const metric = metricsBySymbol.get(s.symbol);
      map.set(s.symbol, {
        ...s,
        name: trackedBySymbol.get(s.symbol)?.name ?? s.name,
        reasoning: s.reasoning ?? null,
        thesisJson: s.thesisJson ?? null,
        macroThesisJson: s.macroThesisJson ?? null,
        perfDay: metric?.perfDay ?? s.perfDay ?? null,
        perfWtd: metric?.perfWtd ?? s.perfWtd ?? null,
        perfMtd: metric?.perfMtd ?? s.perfMtd ?? null,
        isSaved: false,
        isWatching: false,
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [trackedStocks, analyses, metrics, shared]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      watching: rows.filter((row) => row.isWatching).length,
      saved: rows.filter((row) => row.isSaved).length,
    }),
    [rows],
  );

  const stateFilteredRows = useMemo(() => {
    if (filter === "watching") return rows.filter((row) => row.isWatching);
    if (filter === "saved") return rows.filter((row) => row.isSaved);
    return rows;
  }, [filter, rows]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const filteredRows = useMemo(() => {
    if (!normalizedSearchQuery) return stateFilteredRows;
    return stateFilteredRows.filter((row) => {
      const haystack = [row.symbol, row.name].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalizedSearchQuery);
    });
  }, [normalizedSearchQuery, stateFilteredRows]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-5xl mx-auto w-full px-6 h-13 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <TrendingUp className="size-4" />
            Bursa
          </div>
          <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
            Today <TodayLabel />
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
              <Badge variant="outline" className="text-[var(--brand)] border-[var(--brand)]/30">
                Admin
              </Badge>
            ) : (
              <>
                <Badge variant="outline">{formatEuro(balance ?? 0)}</Badge>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">€</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={topupAmount}
                    onChange={(e) => setTopupAmount(e.target.value)}
                    className="w-14 h-7 px-1.5 text-sm rounded border border-border bg-background text-center"
                  />
                  <Button size="sm" onClick={startCheckout} className="cursor-pointer">
                    Top up
                  </Button>
                </div>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {showTopupToast && (
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
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Wallet topped up</div>
              <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                Your purchase completed. Funds are ready to use.
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setShowTopupToast(false)}>
              <X size={12} />
            </Button>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto w-full px-6 py-6">
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
                Stocks
              </div>
              <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Your stocks</h2>
              <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>
                Save stocks to store them here, then promote the important ones to watching.
              </p>
            </div>
          </div>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-4 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1 lg:max-w-xl">
                  <StockSearchBar
                    query={searchQuery}
                    onQueryChange={setSearchQuery}
                    onChanged={reload}
                    existingSymbols={rows.map((row) => row.symbol)}
                    maxWidth="100%"
                  />
                  <div className="mt-2 min-h-4 text-xs text-muted-foreground">
                    {metricsQuery.isLoading
                      ? "Loading market snapshots…"
                      : metricsQuery.isFetching
                        ? "Refreshing market snapshots…"
                        : null}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {(
                    [
                      ["watching", "Watching"],
                      ["saved", "Saved"],
                      ["all", "All"],
                    ] as const
                  ).map(([value, label]) => {
                    const active = filter === value;
                    return (
                      <Button
                        key={value}
                        type="button"
                        size="sm"
                        variant={active ? "secondary" : "outline"}
                        onClick={() => onFilterChange(value)}
                        className="cursor-pointer"
                      >
                        <span>{label}</span>
                        <span className="text-[11px] text-muted-foreground">{counts[value]}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>

            {filteredRows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
                <TrendingUp className="size-8 text-muted-foreground/40" />
                <p className="font-medium">
                  {normalizedSearchQuery
                    ? `No stocks match “${searchQuery.trim()}” in this view`
                    : filter === "watching"
                      ? "No watched stocks yet"
                      : filter === "saved"
                        ? "No saved stocks yet"
                        : "No stocks yet"}
                </p>
                <p className="text-sm">
                  {normalizedSearchQuery
                    ? "Try another symbol or company name, or use the market results above to add a new stock."
                    : filter === "watching"
                      ? "Use the magnifier to promote saved stocks into your active watch list."
                      : filter === "saved"
                        ? "Use the search inside the table to save stocks. Watched stocks will appear here too."
                        : "Use the search inside the table to save new stocks or promote them to watching."}
                </p>
              </div>
            ) : (
              <SharedAnalysisTable
                rows={filteredRows}
                onToggleSave={handleToggleSave}
                onToggleWatch={handleToggleWatch}
                mutatingKey={toggling}
              />
            )}
          </Card>
        </section>
      </main>

      <style>{`.spin { animation: spin 1s linear infinite } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
