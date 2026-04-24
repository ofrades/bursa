import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles, TrendingUp, Users, X } from "lucide-react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getMultipleAnalyses,
  getRecentSharedAnalyses,
} from "../server/stocks";
import { getSession } from "../server/session";
import type { StockAnalysis } from "../lib/schema";
import { StockSearchBar } from "./StockSearchBar";
import { Badge, SignalBadge, type Signal } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { SharedAnalysisTable } from "./SharedAnalysisTable";

type SharedRow = {
  symbol: string;
  signal: string;
  confidence: number | null;
  updatedAt: Date | null;
  name: string | null;
};

type Props = {
  session: { sub: string; image?: string | null } | null;
  walletBalance: number;
  isAdmin: boolean;
  initialWatchlist: Array<{
    symbol: string;
    name: string | null;
    exchange: string | null;
  }>;
  initialAnalyses: StockAnalysis[];
  initialShared: SharedRow[];
};

function formatEuro(cents: number): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function pctColor(v: number | null | undefined) {
  if (v == null || v === 0) return "";
  return v > 0 ? "text-emerald-500" : "text-red-500";
}
function pctStr(v: number | null | undefined) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
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
  walletBalance,
  isAdmin,
  initialWatchlist,
  initialAnalyses,
  initialShared,
}: Props) {
  const [watchlist, setWatchlist] = useState(initialWatchlist);
  const [analyses, setAnalyses] = useState<StockAnalysis[]>(initialAnalyses);
  const [shared, setShared] = useState<SharedRow[]>(initialShared);
  const [balance, setBalance] = useState(walletBalance);
  const [showTopupToast, setShowTopupToast] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState<string>("1");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("topup") === "1") {
      setShowTopupToast(true);
      url.searchParams.delete("topup");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const reload = useCallback(async () => {
    const wl = await getWatchlist();
    const syms = wl.map((w) => w.symbol);
    const [newAnalyses, newShared, freshSession] = await Promise.all([
      getMultipleAnalyses({ data: { symbols: syms } }),
      getRecentSharedAnalyses(),
      getSession(),
    ]);
    setWatchlist(wl);
    setAnalyses(newAnalyses);
    setShared(newShared);
    setBalance(freshSession?.walletBalance ?? 0);
  }, []);

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
  const handleToggleSave = async (symbol: string, isSaved: boolean) => {
    setToggling(symbol);
    try {
      if (isSaved) {
        await removeFromWatchlist({ data: { symbol } });
      } else {
        const name =
          watchlist.find((w) => w.symbol === symbol)?.name ??
          shared.find((s) => s.symbol === symbol)?.name ??
          undefined;
        await addToWatchlist({ data: { symbol, name } });
      }
      await reload();
    } finally {
      setToggling(null);
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
        <div style={{ marginBottom: 24 }}>
          <StockSearchBar onAdded={reload} watchlistSymbols={watchlist.map((w) => w.symbol)} />
        </div>

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
              <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
                Watchlist & community
              </h2>
              <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>
                Star a stock to save it to your watchlist. Click a row to see the full breakdown.
              </p>
            </div>
          </div>

          <Card className="overflow-hidden p-0">
            {(() => {
              const map = new Map<string, SharedRow & { isSaved: boolean }>();
              for (const w of watchlist) {
                const a = analyses.find((x) => x.symbol === w.symbol);
                map.set(w.symbol, {
                  symbol: w.symbol,
                  name: w.name ?? null,
                  signal: a?.signal ?? "HOLD",
                  confidence: a?.confidence ?? null,
                  updatedAt: a?.updatedAt ?? null,
                  isSaved: true,
                });
              }
              for (const s of shared) {
                if (map.has(s.symbol)) continue;
                map.set(s.symbol, { ...s, isSaved: false });
              }
              const rows = Array.from(map.values());
              return rows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
                  <TrendingUp className="size-8 text-muted-foreground/40" />
                  <p className="font-medium">No stocks yet</p>
                  <p className="text-sm">Search above to add or discover stocks.</p>
                </div>
              ) : (
                <SharedAnalysisTable
                  rows={rows}
                  onToggleSave={handleToggleSave}
                  savingSymbol={toggling}
                />
              );
            })()}
          </Card>
        </section>
      </main>

      <style>{`.spin { animation: spin 1s linear infinite } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
