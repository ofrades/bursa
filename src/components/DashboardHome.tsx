import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles, TrendingUp, Users, X } from "lucide-react";
import { format, startOfWeek, endOfWeek } from "date-fns";
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
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

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

const SIGNAL_COLOR: Record<string, string> = {
  STRONG_BUY: "var(--accent)",
  BUY: "var(--accent)",
  HOLD: "var(--warning)",
  SELL: "var(--danger)",
  STRONG_SELL: "var(--danger)",
};
const SIGNAL_BG: Record<string, string> = {
  STRONG_BUY: "var(--accent-subtle)",
  BUY: "var(--accent-subtle)",
  HOLD: "#3f2a00",
  SELL: "#3f0000",
  STRONG_SELL: "#3f0000",
};

function pctColor(v: number | null | undefined) {
  if (v == null) return "var(--fg-muted)";
  return v > 0 ? "var(--accent)" : v < 0 ? "var(--danger)" : "var(--fg-muted)";
}
function pctStr(v: number | null | undefined) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function WeekLabel() {
  const t = new Date();
  return (
    <span
      suppressHydrationWarning
      style={{ color: "var(--fg)", fontWeight: 500 }}
    >
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
    <div style={{ minHeight: "100vh" }}>
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          position: "sticky",
          top: 0,
          zIndex: 40,
          background: "var(--bg)",
        }}
      >
        <div
          style={{
            maxWidth: 1300,
            margin: "0 auto",
            padding: "0 24px",
            height: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TrendingUp size={18} color="var(--accent)" />
            <span style={{ fontWeight: 700, fontSize: 15 }}>StockTrack</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--accent)",
                display: "inline-block",
              }}
            />
            <span style={{ color: "var(--fg-muted)" }}>
              Week of <WeekLabel />
            </span>
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
                className="text-[var(--accent)] border-[var(--accent)]/30"
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
            background: "color-mix(in srgb, var(--accent) 8%, transparent)",
            borderBottom: "1px solid var(--border)",
            padding: "10px 24px",
          }}
        >
          <div
            style={{
              maxWidth: 1300,
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
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
                background: "var(--accent)",
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
                    ? "var(--accent)"
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

      <main style={{ maxWidth: 1300, margin: "0 auto", padding: "24px" }}>
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
            <Card
              className="text-center"
              style={{
                padding: "48px 24px",
                color: "var(--fg-muted)",
              }}
            >
              <TrendingUp
                size={36}
                color="var(--fg-subtle)"
                style={{ marginBottom: 12 }}
              />
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
                Your watchlist is empty
              </div>
              <div style={{ fontSize: 14 }}>Search above to add stocks.</div>
            </Card>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
                gap: 14,
              }}
            >
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
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <Card style={{ cursor: "pointer", height: "100%" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "start",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "center",
                          }}
                        >
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 10,
                              background: "var(--accent-subtle)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: "var(--accent)",
                              }}
                            >
                              {symbol.slice(0, 4)}
                            </span>
                          </div>
                          <div>
                            <div
                              style={{
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              {symbol}
                              {sharedByCommunity && (
                                <span
                                  style={{
                                    fontSize: 9,
                                    border: "1px solid var(--border)",
                                    color: "var(--fg-subtle)",
                                    borderRadius: 4,
                                    padding: "1px 4px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                  }}
                                >
                                  <Users size={9} /> community
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--fg-subtle)",
                              }}
                            >
                              {name ?? "—"}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRemove(symbol);
                          }}
                        >
                          {removing === symbol ? (
                            <Loader2 size={12} className="spin" />
                          ) : (
                            <X size={12} />
                          )}
                        </Button>
                      </div>

                      <div className="separator" style={{ margin: "12px 0" }} />

                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 10,
                        }}
                      >
                        <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                          Analysis
                        </div>
                        {analysis ? (
                          <span
                            style={{
                              display: "inline-block",
                              padding: "3px 8px",
                              borderRadius: 6,
                              background:
                                SIGNAL_BG[analysis.signal] ?? "var(--bg-muted)",
                              color:
                                SIGNAL_COLOR[analysis.signal] ?? "var(--fg)",
                              fontWeight: 700,
                              fontSize: 11,
                            }}
                          >
                            {analysis.signal.replace("_", " ")}
                          </span>
                        ) : (
                          <span
                            style={{ fontSize: 12, color: "var(--fg-subtle)" }}
                          >
                            Not analyzed yet
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            background: "var(--bg-muted)",
                            borderRadius: 8,
                            padding: "6px 8px",
                          }}
                        >
                          <div
                            style={{ fontSize: 11, color: "var(--fg-subtle)" }}
                          >
                            WTD
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: pctColor(m?.perfWtd),
                            }}
                          >
                            {pctStr(m?.perfWtd)}
                          </div>
                        </div>
                        <div
                          style={{
                            background: "var(--bg-muted)",
                            borderRadius: 8,
                            padding: "6px 8px",
                          }}
                        >
                          <div
                            style={{ fontSize: 11, color: "var(--fg-subtle)" }}
                          >
                            MTD
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: pctColor(m?.perfMtd),
                            }}
                          >
                            {pctStr(m?.perfMtd)}
                          </div>
                        </div>
                        <div
                          style={{
                            background: "var(--bg-muted)",
                            borderRadius: 8,
                            padding: "6px 8px",
                          }}
                        >
                          <div
                            style={{ fontSize: 11, color: "var(--fg-subtle)" }}
                          >
                            YTD
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: pctColor(m?.perfYtd),
                            }}
                          >
                            {pctStr(m?.perfYtd)}
                          </div>
                        </div>
                      </div>

                      <div
                        className="separator"
                        style={{ margin: "12px 0 10px" }}
                      />

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                          {analysis?.updatedAt
                            ? `Updated ${new Date(analysis.updatedAt).toLocaleDateString()}`
                            : "Run the first analysis for this stock"}
                          {!isAdmin && (
                            <span style={{ color: "var(--fg-subtle)" }}>
                              {" "}
                              · 1 credit
                            </span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          disabled={analyzing === symbol || removing === symbol}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleAnalyze(symbol);
                          }}
                        >
                          {analyzing === symbol ? (
                            <Loader2 size={12} className="spin" />
                          ) : (
                            <Sparkles size={12} />
                          )}
                          {analyzing === symbol
                            ? "Analyzing…"
                            : analysis
                              ? "Refresh analysis"
                              : "Run analysis"}
                        </Button>
                      </div>
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
              <Table>
                <TableHeader>
                  <TableRow style={{ borderBottomColor: "var(--border)" }}>
                    {[
                      "Symbol",
                      "Signal",
                      "Conf.",
                      "WTD",
                      "MTD",
                      "YTD",
                      "Next Earnings",
                      "Updated",
                    ].map((h) => (
                      <TableHead
                        key={h}
                        className={h === "Symbol" ? "text-left" : "text-center"}
                      >
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shared.map((row) => {
                    const style = row.signal
                      ? {
                          color: SIGNAL_COLOR[row.signal] ?? "var(--fg)",
                          bg: SIGNAL_BG[row.signal] ?? "var(--bg-muted)",
                        }
                      : null;
                    return (
                      <TableRow
                        key={`${row.symbol}-${String(row.updatedAt)}`}
                        style={{ borderBottomColor: "var(--border)" }}
                      >
                        <TableCell>
                          <Link
                            to="/$symbol"
                            params={{ symbol: row.symbol }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              textDecoration: "none",
                              color: "inherit",
                            }}
                          >
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                background: "var(--accent-subtle)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  color: "var(--accent)",
                                }}
                              >
                                {row.symbol.slice(0, 4)}
                              </span>
                            </div>
                            <div>
                              <div style={{ fontWeight: 700 }}>
                                {row.symbol}
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--fg-subtle)",
                                }}
                              >
                                {row.name ?? "—"}
                              </div>
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell className="text-center">
                          {style && (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 8px",
                                borderRadius: 6,
                                background: style.bg,
                                color: style.color,
                                fontWeight: 700,
                                fontSize: 11,
                              }}
                            >
                              {row.signal.replace("_", " ")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-center"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          {row.confidence != null ? `${row.confidence}%` : "—"}
                        </TableCell>
                        <TableCell
                          className="text-center"
                          style={{
                            color: pctColor(row.perfWtd),
                            fontWeight: 600,
                          }}
                        >
                          {pctStr(row.perfWtd)}
                        </TableCell>
                        <TableCell
                          className="text-center"
                          style={{
                            color: pctColor(row.perfMtd),
                            fontWeight: 600,
                          }}
                        >
                          {pctStr(row.perfMtd)}
                        </TableCell>
                        <TableCell
                          className="text-center"
                          style={{
                            color: pctColor(row.perfYtd),
                            fontWeight: 600,
                          }}
                        >
                          {pctStr(row.perfYtd)}
                        </TableCell>
                        <TableCell
                          className="text-center"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          {row.nextEarningsDate ?? "—"}
                        </TableCell>
                        <TableCell
                          className="text-center"
                          style={{ color: "var(--fg-subtle)" }}
                        >
                          {row.updatedAt
                            ? new Date(row.updatedAt).toLocaleDateString()
                            : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </section>
      </main>

      <style>{`.spin { animation: spin 1s linear infinite } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
