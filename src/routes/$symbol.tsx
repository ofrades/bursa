import { createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  CircleAlert,
  Sparkles,
} from "lucide-react";
import { cn } from "#/lib/utils";
import { Badge, SignalBadge, type Signal } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardAction,
} from "../components/ui/card";
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

function pctClass(v: number | null | undefined) {
  if (v == null) return "text-muted-foreground";
  return v > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : v < 0
      ? "text-red-600 dark:text-red-400"
      : "text-muted-foreground";
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

function MetricCard({
  label,
  value,
  detail,
  valueClass,
}: {
  label: string;
  value: string;
  detail?: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="text-xs uppercase tracking-wider">
          {label}
        </CardDescription>
        <CardTitle
          className={cn(
            "text-xl font-bold tabular-nums whitespace-nowrap",
            valueClass,
          )}
        >
          {value}
        </CardTitle>
        {detail && (
          <CardDescription className="text-xs">{detail}</CardDescription>
        )}
      </CardHeader>
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
  const bullishFactors = recommendation?.keyBullishFactors ?? [];
  const bearishFactors = recommendation?.keyBearishFactors ?? [];

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
            {stock?.exchange && (
              <Badge variant="outline">{stock.exchange}</Badge>
            )}
            {latestAnalysis ? (
              <div className="flex items-center gap-1.5">
                <Sparkles className="size-3 text-muted-foreground" />
                <SignalBadge signal={latestAnalysis.signal as Signal} />
              </div>
            ) : (
              <Badge variant="outline">No analysis yet</Badge>
            )}
          </div>
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
                    {[stock?.name, stock?.sector, stock?.industry]
                      .filter(Boolean)
                      .join(" · ") || "Stock detail page"}
                  </CardDescription>
                </div>
              </div>

              <div className="text-right shrink-0 min-w-[160px]">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Latest update
                </p>
                <p className="text-2xl font-bold tabular-nums mb-1.5">
                  {moneyStr(
                    metrics?.currentPrice ??
                      latestAnalysis?.priceAtAnalysis ??
                      null,
                  )}
                </p>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>Updated: {dateStr(latestAnalysis?.updatedAt, true)}</p>
                  <p>
                    Confidence:{" "}
                    {latestAnalysis?.confidence != null
                      ? `${latestAnalysis.confidence}%`
                      : "—"}
                  </p>
                  <p>{session ? "Signed in" : "Browsing public data"}</p>
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Metric strip */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          <MetricCard
            label="Current price"
            value={moneyStr(
              metrics?.currentPrice ?? latestAnalysis?.priceAtAnalysis ?? null,
            )}
          />
          <MetricCard
            label="WTD"
            value={pctStr(metrics?.perfWtd)}
            detail={
              metrics?.momentumSignal
                ? `Momentum ${metrics.momentumSignal}`
                : undefined
            }
            valueClass={pctClass(metrics?.perfWtd)}
          />
          <MetricCard
            label="MTD"
            value={pctStr(metrics?.perfMtd)}
            valueClass={pctClass(metrics?.perfMtd)}
          />
          <MetricCard
            label="YTD"
            value={pctStr(metrics?.perfYtd)}
            valueClass={pctClass(metrics?.perfYtd)}
          />
          <MetricCard
            label="Next earnings"
            value={metrics?.nextEarningsDate ?? "—"}
          />
          <MetricCard
            label="P/E"
            value={numberStr(metrics?.peRatio)}
            detail={
              metrics?.forwardPe != null
                ? `Forward ${numberStr(metrics?.forwardPe)}`
                : undefined
            }
          />
        </div>

        {/* No analysis state */}
        {!latestAnalysis && (
          <Card>
            <CardContent className="flex items-start gap-3 pt-5">
              <CircleAlert className="size-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-1">
                  No analysis generated for {symbol} yet
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Add it to your watchlist from the home page and run an
                  analysis to populate this view.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Analysis + factors */}
        {latestAnalysis && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {/* AI analysis card */}
            <Card>
              <CardHeader>
                <div>
                  <CardDescription className="text-xs uppercase tracking-wider mb-0.5">
                    AI analysis
                  </CardDescription>
                  <CardTitle className="text-xl">
                    Weekly recommendation
                  </CardTitle>
                </div>
                <CardAction>
                  <SignalBadge signal={latestAnalysis.signal as Signal} />
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {/* Mini metric grid */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: "Confidence",
                      value:
                        latestAnalysis.confidence != null
                          ? `${latestAnalysis.confidence}%`
                          : "—",
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
                    <div
                      key={label}
                      className="rounded-lg bg-muted/60 px-3 py-3"
                    >
                      <p className="text-xs text-muted-foreground mb-1">
                        {label}
                      </p>
                      <p className="text-base font-semibold">{value}</p>
                    </div>
                  ))}
                </div>

                {recommendation?.weeklyOutlook && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                      Weekly outlook
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {recommendation.weeklyOutlook}
                    </p>
                  </div>
                )}

                {recommendation?.reasoning && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                      Reasoning
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {recommendation.reasoning}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Bullish / Bearish */}
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardDescription className="text-xs uppercase tracking-wider">
                    Bullish factors
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
                    <p className="text-sm text-muted-foreground">
                      No bullish factors saved.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardDescription className="text-xs uppercase tracking-wider">
                    Bearish factors
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
                      No bearish factors saved.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* History + signals */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Analysis history table */}
          <Card className="p-0 overflow-hidden gap-0">
            <CardHeader className="border-b px-5 py-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="size-4 text-muted-foreground" />
                <div>
                  <CardDescription className="text-xs uppercase tracking-wider">
                    History
                  </CardDescription>
                  <CardTitle className="text-base">
                    Recent analysis runs
                  </CardTitle>
                </div>
              </div>
            </CardHeader>
            {data.analysisHistory.length === 0 ? (
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground">
                  No previous analysis runs yet.
                </p>
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week</TableHead>
                    <TableHead className="text-center">Signal</TableHead>
                    <TableHead className="text-center">Confidence</TableHead>
                    <TableHead className="text-center">Price</TableHead>
                    <TableHead className="text-center">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.analysisHistory.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium text-xs">
                        {row.weekStart} → {row.weekEnd}
                      </TableCell>
                      <TableCell className="text-center">
                        <SignalBadge signal={row.signal as Signal} />
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {row.confidence != null ? `${row.confidence}%` : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {moneyStr(row.priceAtAnalysis)}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {dateStr(row.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          {/* Daily signal log */}
          <Card className="p-0 overflow-hidden gap-0">
            <CardHeader className="border-b px-5 py-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-muted-foreground" />
                <div>
                  <CardDescription className="text-xs uppercase tracking-wider">
                    Signals
                  </CardDescription>
                  <CardTitle className="text-base">Daily signal log</CardTitle>
                </div>
              </div>
            </CardHeader>
            {data.dailySignals.length === 0 ? (
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground">
                  No daily signal updates for the latest analysis yet.
                </p>
              </CardContent>
            ) : (
              <div>
                {data.dailySignals.map((row) => (
                  <div key={row.id} className="px-5 py-4 border-b last:border-0">
                    <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                      <span className="text-sm font-medium">{row.date}</span>
                      <SignalBadge signal={row.signal as Signal} />
                    </div>
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <span>Trigger: {row.trigger}</span>
                      <span>Price: {moneyStr(row.priceAtUpdate)}</span>
                      {row.note && (
                        <span className="leading-relaxed">{row.note}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
