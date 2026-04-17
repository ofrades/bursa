import { createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  CircleAlert,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
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
import { getStockPageData } from "../server/stocks";

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
};

function parseRecommendation(value: unknown): ParsedRecommendation | null {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value) as ParsedRecommendation;
  } catch {
    return null;
  }
}

function signalStyle(signal?: string | null) {
  if (!signal) return { color: "var(--fg-muted)", bg: "var(--bg-muted)" };
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

function moneyStr(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: v >= 100 ? 0 : 2,
  }).format(v);
}

function numberStr(v: number | null | undefined, digits = 1) {
  if (v == null) return "—";
  return v.toFixed(digits);
}

function dateStr(v: string | Date | null | undefined, withTime = false) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

function metricCard(
  label: string,
  value: string,
  detail?: string,
  tone?: string,
) {
  return (
    <Card style={{ padding: 16 }}>
      <div
        style={{
          fontSize: 11,
          color: "var(--fg-subtle)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: tone ?? "var(--fg)",
          marginBottom: detail ? 4 : 0,
        }}
      >
        {value}
      </div>
      {detail ? (
        <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>{detail}</div>
      ) : null}
    </Card>
  );
}

function StockPage() {
  const data = Route.useLoaderData();
  const params = Route.useParams();
  const { session } = Route.useRouteContext();

  const symbol = params.symbol.toUpperCase();
  const stock = data.stock;
  const metrics = data.metrics;
  const latestAnalysis = data.latestAnalysis;
  const recommendation = parseRecommendation(latestAnalysis?.reasoning);
  const style = signalStyle(latestAnalysis?.signal);
  const bullishFactors = recommendation?.keyBullishFactors ?? [];
  const bearishFactors = recommendation?.keyBearishFactors ?? [];

  return (
    <div style={{ minHeight: "100vh", padding: "28px 24px 56px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 24,
          }}
        >
          <Button asChild variant="secondary" size="sm">
            <a href="/">
              <ChevronLeft size={14} /> Back
            </a>
          </Button>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {stock?.exchange ? (
              <Badge variant="outline">{stock.exchange}</Badge>
            ) : null}
            {latestAnalysis ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 10px",
                  borderRadius: 999,
                  background: style.bg,
                  color: style.color,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <Sparkles size={12} />{" "}
                {latestAnalysis.signal.replaceAll("_", " ")}
              </span>
            ) : (
              <Badge variant="outline">No analysis yet</Badge>
            )}
          </div>
        </div>

        <Card style={{ padding: 24, marginBottom: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "start",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 8,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    background: "var(--accent-subtle)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: "var(--accent)",
                    }}
                  >
                    {symbol.slice(0, 4)}
                  </span>
                </div>
                <div>
                  <h1
                    style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.05 }}
                  >
                    {symbol}
                  </h1>
                  <div style={{ color: "var(--fg-muted)", marginTop: 4 }}>
                    {stock?.name ?? "Stock detail page"}
                    {stock?.sector ? ` · ${stock.sector}` : ""}
                    {stock?.industry ? ` · ${stock.industry}` : ""}
                  </div>
                </div>
              </div>
              <p
                style={{
                  maxWidth: 760,
                  color: "var(--fg-muted)",
                  lineHeight: 1.6,
                }}
              >
                This page now renders the actual stock detail view for{" "}
                <strong style={{ color: "var(--fg)" }}>{symbol}</strong>,
                including the latest shared analysis, current metrics, and
                recent signal history.
              </p>
            </div>

            <div style={{ minWidth: 240 }}>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--fg-subtle)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 8,
                }}
              >
                Latest update
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>
                {moneyStr(
                  metrics?.currentPrice ??
                    latestAnalysis?.priceAtAnalysis ??
                    null,
                )}
              </div>
              <div
                style={{
                  display: "grid",
                  gap: 6,
                  fontSize: 13,
                  color: "var(--fg-muted)",
                }}
              >
                <div>Updated: {dateStr(latestAnalysis?.updatedAt, true)}</div>
                <div>
                  Confidence:{" "}
                  {latestAnalysis?.confidence != null
                    ? `${latestAnalysis.confidence}%`
                    : "—"}
                </div>
                <div>{session ? "Signed in" : "Browsing public data"}</div>
              </div>
            </div>
          </div>
        </Card>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 18,
          }}
        >
          {metricCard(
            "Current price",
            moneyStr(
              metrics?.currentPrice ?? latestAnalysis?.priceAtAnalysis ?? null,
            ),
          )}
          {metricCard(
            "WTD",
            pctStr(metrics?.perfWtd),
            metrics?.momentumSignal
              ? `Momentum ${metrics.momentumSignal}`
              : undefined,
            pctColor(metrics?.perfWtd),
          )}
          {metricCard(
            "MTD",
            pctStr(metrics?.perfMtd),
            undefined,
            pctColor(metrics?.perfMtd),
          )}
          {metricCard(
            "YTD",
            pctStr(metrics?.perfYtd),
            undefined,
            pctColor(metrics?.perfYtd),
          )}
          {metricCard("Next earnings", metrics?.nextEarningsDate ?? "—")}
          {metricCard(
            "P/E",
            numberStr(metrics?.peRatio),
            metrics?.forwardPe != null
              ? `Forward ${numberStr(metrics?.forwardPe)}`
              : undefined,
          )}
        </section>

        {!latestAnalysis ? (
          <Card style={{ padding: 22, marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "start", gap: 12 }}>
              <CircleAlert
                size={18}
                color="var(--warning)"
                style={{ flexShrink: 0, marginTop: 2 }}
              />
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
                  No analysis has been generated for {symbol} yet
                </h2>
                <p style={{ color: "var(--fg-muted)", lineHeight: 1.6 }}>
                  The route is working correctly now, but there is no saved
                  analysis for this stock yet. Add it to your watchlist from the
                  home page and run an analysis to populate this view.
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 18,
              alignItems: "start",
              marginBottom: 18,
            }}
          >
            <Card style={{ padding: 22 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
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
                      letterSpacing: "0.06em",
                      marginBottom: 6,
                    }}
                  >
                    AI analysis
                  </div>
                  <h2 style={{ fontSize: 24, fontWeight: 800 }}>
                    Weekly recommendation
                  </h2>
                </div>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: style.bg,
                    color: style.color,
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  <TrendingUp size={14} />{" "}
                  {latestAnalysis.signal.replaceAll("_", " ")}
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 10,
                  marginBottom: 18,
                }}
              >
                <div
                  style={{
                    background: "var(--bg-muted)",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--fg-subtle)",
                      marginBottom: 6,
                    }}
                  >
                    Confidence
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>
                    {latestAnalysis.confidence != null
                      ? `${latestAnalysis.confidence}%`
                      : "—"}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--bg-muted)",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--fg-subtle)",
                      marginBottom: 6,
                    }}
                  >
                    Risk
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>
                    {recommendation?.riskLevel ?? "—"}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--bg-muted)",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--fg-subtle)",
                      marginBottom: 6,
                    }}
                  >
                    Price target
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>
                    {moneyStr(recommendation?.priceTarget)}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--bg-muted)",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--fg-subtle)",
                      marginBottom: 6,
                    }}
                  >
                    Stop loss
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>
                    {moneyStr(recommendation?.stopLoss)}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 18 }}>
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--fg-subtle)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 8,
                    }}
                  >
                    Weekly outlook
                  </div>
                  <p style={{ lineHeight: 1.7, color: "var(--fg-muted)" }}>
                    {recommendation?.weeklyOutlook ??
                      "No weekly outlook saved yet."}
                  </p>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--fg-subtle)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 8,
                    }}
                  >
                    Reasoning
                  </div>
                  <p style={{ lineHeight: 1.7, color: "var(--fg-muted)" }}>
                    {recommendation?.reasoning ?? "No reasoning saved yet."}
                  </p>
                </div>
              </div>
            </Card>

            <section style={{ display: "grid", gap: 18 }}>
              <Card style={{ padding: 22 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--fg-subtle)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 10,
                  }}
                >
                  Bullish factors
                </div>
                {bullishFactors.length ? (
                  <ul
                    style={{
                      paddingLeft: 18,
                      display: "grid",
                      gap: 10,
                      color: "var(--fg-muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    {bullishFactors.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ color: "var(--fg-muted)" }}>
                    No bullish factors saved.
                  </div>
                )}
              </Card>

              <Card style={{ padding: 22 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--fg-subtle)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 10,
                  }}
                >
                  Bearish factors
                </div>
                {bearishFactors.length ? (
                  <ul
                    style={{
                      paddingLeft: 18,
                      display: "grid",
                      gap: 10,
                      color: "var(--fg-muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    {bearishFactors.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ color: "var(--fg-muted)" }}>
                    No bearish factors saved.
                  </div>
                )}
              </Card>
            </section>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 18,
            alignItems: "start",
          }}
        >
          <Card className="overflow-hidden p-0">
            <div
              style={{
                padding: "18px 20px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <BarChart3 size={16} color="var(--accent)" />
              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--fg-subtle)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  History
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                  Recent analysis runs
                </h3>
              </div>
            </div>
            {data.analysisHistory.length === 0 ? (
              <div style={{ padding: 20, color: "var(--fg-muted)" }}>
                No previous analysis runs yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow style={{ borderBottomColor: "var(--border)" }}>
                    {["Week", "Signal", "Confidence", "Price", "Updated"].map(
                      (h) => (
                        <TableHead
                          key={h}
                          className={h === "Week" ? "text-left" : "text-center"}
                        >
                          {h}
                        </TableHead>
                      ),
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.analysisHistory.map((row) => {
                    const rowStyle = signalStyle(row.signal);
                    return (
                      <TableRow
                        key={row.id}
                        style={{ borderBottomColor: "var(--border)" }}
                      >
                        <TableCell style={{ fontWeight: 600 }}>
                          {row.weekStart} → {row.weekEnd}
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            style={{
                              display: "inline-block",
                              padding: "3px 8px",
                              borderRadius: 999,
                              background: rowStyle.bg,
                              color: rowStyle.color,
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {row.signal.replaceAll("_", " ")}
                          </span>
                        </TableCell>
                        <TableCell
                          className="text-center"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          {row.confidence != null ? `${row.confidence}%` : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {moneyStr(row.priceAtAnalysis)}
                        </TableCell>
                        <TableCell
                          className="text-center"
                          style={{ color: "var(--fg-subtle)" }}
                        >
                          {dateStr(row.updatedAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="overflow-hidden p-0">
            <div
              style={{
                padding: "18px 20px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <CalendarDays size={16} color="var(--accent)" />
              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--fg-subtle)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Signals
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                  Daily signal log
                </h3>
              </div>
            </div>
            {data.dailySignals.length === 0 ? (
              <div style={{ padding: 20, color: "var(--fg-muted)" }}>
                No daily signal updates for the latest analysis yet.
              </div>
            ) : (
              <div style={{ display: "grid" }}>
                {data.dailySignals.map((row) => {
                  const rowStyle = signalStyle(row.signal);
                  return (
                    <div
                      key={row.id}
                      style={{
                        padding: "14px 20px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{row.date}</div>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 8px",
                            borderRadius: 999,
                            background: rowStyle.bg,
                            color: rowStyle.color,
                            fontWeight: 700,
                            fontSize: 11,
                          }}
                        >
                          {row.signal.replaceAll("_", " ")}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gap: 4,
                          fontSize: 12,
                          color: "var(--fg-muted)",
                        }}
                      >
                        <div>Trigger: {row.trigger}</div>
                        <div>Price: {moneyStr(row.priceAtUpdate)}</div>
                        {row.note ? (
                          <div style={{ lineHeight: 1.5 }}>{row.note}</div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
