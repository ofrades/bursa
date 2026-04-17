import { createFileRoute, Link } from "@tanstack/react-router";
import { TrendingUp, Zap, Users } from "lucide-react";
import {
  getRecentSharedAnalyses,
  getWatchlist,
  getMultipleAnalyses,
  getMultipleMetrics,
} from "../server/stocks";
import { DashboardHome } from "../components/DashboardHome";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    const analyses = await getRecentSharedAnalyses();

    if (!context.session) {
      return { mode: "landing" as const, analyses };
    }

    const watchlist = await getWatchlist();
    const symbols = watchlist.map((w) => w.symbol);
    const [myAnalyses, myMetrics] = await Promise.all([
      getMultipleAnalyses({ data: { symbols } }),
      getMultipleMetrics({ data: { symbols } }),
    ]);

    return {
      mode: "dashboard" as const,
      analyses,
      watchlist,
      myAnalyses,
      myMetrics,
    };
  },
  component: HomePage,
});

function signalStyles(signal: string) {
  if (signal.includes("BUY"))
    return { color: "var(--accent)", bg: "var(--accent-subtle)" };
  if (signal.includes("SELL")) return { color: "var(--danger)", bg: "#3f0000" };
  return { color: "var(--warning)", bg: "#3f2a00" };
}
function pctColor(v: number | null | undefined) {
  if (v == null) return "var(--fg-muted)";
  return v > 0 ? "var(--accent)" : v < 0 ? "var(--danger)" : "var(--fg-muted)";
}
function pctStr(v: number | null | undefined) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function HomePage() {
  const data = Route.useLoaderData() as any;
  const { session, analysisCredits, isAdmin } = Route.useRouteContext();

  if (data.mode === "dashboard") {
    return (
      <DashboardHome
        session={session}
        analysisCredits={analysisCredits}
        isAdmin={isAdmin}
        initialWatchlist={data.watchlist}
        initialAnalyses={data.myAnalyses}
        initialMetrics={data.myMetrics}
        initialShared={data.analyses}
      />
    );
  }

  const analyses = data.analyses;
  return (
    <div style={{ minHeight: "100vh", padding: "32px 24px 64px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div
          style={{
            textAlign: "center",
            maxWidth: 760,
            margin: "40px auto 56px",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 28,
            }}
          >
            <div
              style={{
                background: "var(--accent-subtle)",
                borderRadius: 12,
                padding: 10,
              }}
            >
              <TrendingUp size={24} color="var(--accent)" />
            </div>
            <span style={{ fontSize: 22, fontWeight: 700 }}>StockTrack</span>
          </div>
          <h1
            style={{
              fontSize: 46,
              fontWeight: 800,
              lineHeight: 1.1,
              marginBottom: 16,
            }}
          >
            Shared stock analysis,{" "}
            <span style={{ color: "var(--accent)" }}>week by week</span>
          </h1>
          <p
            style={{
              fontSize: 18,
              color: "var(--fg-muted)",
              lineHeight: 1.7,
              marginBottom: 32,
            }}
          >
            Add stocks to your watchlist. See analyses already created by the
            community. Buy credits only when you want to run your own new
            analysis.
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 40,
            }}
          >
            <Button asChild size="lg">
              <a href="/api/auth/google/start">Continue with Google</a>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <a href="#shared-table">See shared analysis</a>
            </Button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
            }}
          >
            {[
              {
                Icon: Users,
                label: "Shared intel",
                desc: "One user’s analysis helps all users",
              },
              {
                Icon: TrendingUp,
                label: "Weekly cycles",
                desc: "Mon–Fri recommendation flow",
              },
              {
                Icon: Zap,
                label: "Pay per use",
                desc: "Credits only when you run analysis",
              },
            ].map(({ Icon, label, desc }) => (
              <Card key={label} className="p-4 text-center">
                <Icon
                  size={20}
                  color="var(--accent)"
                  style={{ marginBottom: 8 }}
                />
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                  {label}
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                  {desc}
                </div>
              </Card>
            ))}
          </div>
        </div>

        <section id="shared-table">
          <div
            style={{
              display: "flex",
              alignItems: "end",
              justifyContent: "space-between",
              gap: 16,
              marginBottom: 16,
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
                  marginBottom: 6,
                }}
              >
                Preview
              </div>
              <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>
                Recent shared analyses
              </h2>
              <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>
                Free to browse. Click a stock to inspect the full detail page.
              </p>
            </div>
            <Button asChild>
              <a href="/api/auth/google/start">Start free</a>
            </Button>
          </div>

          <Card className="overflow-hidden p-0">
            {analyses.length === 0 ? (
              <div
                style={{
                  padding: 28,
                  textAlign: "center",
                  color: "var(--fg-muted)",
                }}
              >
                No public analyses yet. Be the first to add a stock and run one.
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
                      "Next earnings",
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
                  {analyses.map((row: any) => {
                    const style = signalStyles(row.signal);
                    return (
                      <TableRow
                        key={`${row.symbol}-${row.updatedAt}`}
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
      </div>
    </div>
  );
}
