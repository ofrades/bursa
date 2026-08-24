import { defineCatalog } from "@json-render/core";
import * as React from "react";
import {
  defineRegistry,
  Renderer,
  StateProvider,
  ActionProvider,
  VisibilityProvider,
  ValidationProvider,
} from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { shadcnComponents } from "@json-render/shadcn";
import { z } from "zod";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "#/lib/utils";
import { normalizeScore } from "./analysis-normalize";
import type { ValueKind, MacroThesis } from "./simple-analysis";
import {
  Card as UICard,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "../components/ui/chart";

const chartSeriesSchema = z.object({
  key: z.string(),
  label: z.string(),
  color: z.string(),
});

const chartPointSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

const catalog = defineCatalog(schema, {
  components: {
    Card: shadcnComponentDefinitions.Card,
    Stack: shadcnComponentDefinitions.Stack,
    Heading: shadcnComponentDefinitions.Heading,
    Text: shadcnComponentDefinitions.Text,
    Badge: shadcnComponentDefinitions.Badge,
    Table: shadcnComponentDefinitions.Table,
    Separator: shadcnComponentDefinitions.Separator,
    GridLayout: {
      props: z.object({
        columns: z.number().int().min(1).max(4).default(1),
      }),
      description: "Responsive grid layout",
    },
    ContextCard: {
      props: z.object({
        title: z.string(),
        summary: z.string(),
      }),
      description: "Context-setting card for supporting evidence",
    },
    StatTile: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        detail: z.string().nullable().optional(),
        trend: z.enum(["up", "down", "flat", "mixed"]),
        tone: z.enum(["good", "caution", "bad", "neutral"]),
      }),
      description: "Simple stat tile",
    },
    EvidenceChart: {
      props: z.object({
        title: z.string(),
        description: z.string().nullable().optional(),
        kind: z.enum(["bar", "line"]),
        valueKind: z.enum(["currency", "percent", "ratio", "index"]),
        series: z.array(chartSeriesSchema),
        points: z.array(chartPointSchema),
      }),
      description: "Evidence chart built with shadcn chart primitives",
    },
    TakeawayList: {
      props: z.object({
        title: z.string(),
        items: z.array(z.string()),
      }),
      description: "Short plain-language takeaway list",
    },
    KpiTile: {
      props: z.object({
        label: z.string(),
        description: z.string(),
        value: z.string(),
        sub: z.string().nullable().optional(),
        trend: z.enum(["up", "down", "flat", "mixed"]),
        tone: z.enum(["good", "caution", "bad", "neutral"]),
      }),
      description: "Single KPI tile with a '?' description popover",
    },
    KpiGrid: {
      props: z.object({
        rows: z.array(
          z.object({
            metricKey: z.enum(["revenue", "netIncome", "freeCashFlow"]),
            metricLabel: z.string(),
            metricDescription: z.string(),
            cadence: z.enum(["quarterly", "annual"]),
            latest: z.object({
              label: z.string(),
              value: z.string(),
              period: z.string(),
              description: z.string(),
              trend: z.enum(["up", "down", "flat", "mixed"]),
              tone: z.enum(["good", "caution", "bad", "neutral"]),
            }),
            qoq: z.object({
              label: z.string(),
              value: z.string().nullable(),
              sub: z.string(),
              description: z.string(),
              trend: z.enum(["up", "down", "flat", "mixed"]),
              tone: z.enum(["good", "caution", "bad", "neutral"]),
            }),
            yoy: z.object({
              label: z.string(),
              value: z.string().nullable(),
              sub: z.string(),
              description: z.string(),
              trend: z.enum(["up", "down", "flat", "mixed"]),
              tone: z.enum(["good", "caution", "bad", "neutral"]),
            }),
            cagr: z.object({
              label: z.string(),
              value: z.string().nullable(),
              sub: z.string(),
              description: z.string(),
            }),
          }),
        ),
      }),
      description:
        "Vertical stack of KPI rows (one per metric) with a Latest/QoQ/YoY/CAGR grid per row",
    },
    CagrTable: {
      props: z.object({
        horizons: z.array(z.object({ label: z.string(), years: z.number() })),
        rows: z.array(
          z.object({
            metricLabel: z.string(),
            cells: z.array(
              z.object({
                horizonLabel: z.string(),
                cagr: z.string().nullable(),
                startValue: z.string().nullable(),
                endValue: z.string().nullable(),
                startLabel: z.string().nullable(),
                endLabel: z.string().nullable(),
              }),
            ),
          }),
        ),
      }),
      description: "Multi-horizon CAGR table — metrics as rows, horizons as columns",
    },
    ValuationCard: {
      props: z.object({
        ttm: z.number().nullable(),
        ntm: z.number().nullable(),
        ttmLabel: z.string(),
        ntmLabel: z.string(),
        trend: z.enum(["up", "down", "flat", "mixed"]),
        tone: z.enum(["good", "caution", "bad", "neutral"]),
        description: z.string(),
      }),
      description:
        "Two-up valuation card showing P/E TTM and P/E NTM with a plain-English description of what they mean",
    },
    BalanceSheetStrip: {
      props: z.object({
        title: z.string(),
        description: z.string().nullable().optional(),
        entries: z.array(
          z.object({
            key: z.enum(["profitability", "shareCount", "debtLoad", "debtService", "cashReturn"]),
            label: z.string(),
            value: z.string(),
            description: z.string(),
            trend: z.enum(["up", "down", "flat", "mixed"]),
            tone: z.enum(["good", "caution", "bad", "neutral"]),
          }),
        ),
      }),
      description:
        "Horizontal strip of 5 compact balance-sheet & valuation stats with always-visible descriptions",
    },
    MacroThesisCard: {
      props: z.object({
        secularBet: z.string(),
        sCurvePosition: z.enum(["early_adopter", "crossing_chasm", "mainstream", "mature"]),
        timeHorizon: z.enum(["2y", "5y", "10y+"]),
        opportunityScore: z.number().min(0).max(100),
        confidence: z.number().min(0).max(100).nullable().optional(),
        dependencyChain: z.array(z.string()),
        bottleneckRole: z.string().nullable().optional(),
        consensusBlindSpot: z.string().nullable().optional(),
        demandGap: z.string(),
        demandScenarios: z
          .array(
            z.object({
              case: z.enum(["bear", "base", "bull"]),
              demandDriver: z.string(),
              demandChangePct: z.number().nullable(),
              businessTransmission: z.string(),
              earningsImpactPct: z.number().nullable(),
              equityImpactPct: z.number().nullable(),
              confidence: z.number().min(0).max(100).nullable().optional(),
            }),
          )
          .optional(),
        repricingTriggers: z.array(z.string()).optional(),
        loadBearingAssumptions: z.array(z.string()),
        falsificationSignals: z.array(z.string()),
      }),
      description:
        "Macro opportunity thesis cornerstone card — secular bet, bottlenecks, demand scenarios, dependency chain, demand gap, assumptions, kill conditions",
    },
  },
  actions: {},
});

function formatChartValue(kind: ValueKind, value: number) {
  if (!Number.isFinite(value)) return "—";

  switch (kind) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
        maximumFractionDigits: Math.abs(value) >= 1_000_000 ? 1 : 0,
      }).format(value);
    case "percent":
      return `${value.toFixed(1)}%`;
    case "ratio":
      return `${value.toFixed(1)}x`;
    case "index":
      return `${value.toFixed(0)}`;
    default:
      return value.toLocaleString();
  }
}

function toneClasses(tone: "good" | "caution" | "bad" | "neutral") {
  switch (tone) {
    case "good":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-400";
    case "caution":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-400";
    case "bad":
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-800/40 dark:bg-red-950/40 dark:text-red-400";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function trendSymbol(trend: "up" | "down" | "flat" | "mixed") {
  switch (trend) {
    case "up":
      return "↑";
    case "down":
      return "↓";
    case "flat":
      return "→";
    default:
      return "•";
  }
}

// Extracted as a module-level const so KpiGrid can reference it directly.
// (It can't reach it via the components object — those are method-shorthand
// properties, not in lexical scope.)
function KpiTileComponent({ props }: { props: z.infer<typeof catalog.components.KpiTile.props> }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 transition-colors hover:border-border">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{props.label}</p>
        <span
          className={cn(
            "inline-flex min-w-6 items-center justify-center rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums",
            toneClasses(props.tone),
          )}
        >
          {trendSymbol(props.trend)}
        </span>
      </div>
      <p className="text-base font-semibold tabular-nums leading-tight">{props.value}</p>
      {props.sub ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums leading-tight">
          {props.sub}
        </p>
      ) : null}
      {props.description ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {props.description}
        </p>
      ) : null}
    </div>
  );
}

const { registry } = defineRegistry(catalog, {
  components: {
    Card: shadcnComponents.Card,
    Stack: shadcnComponents.Stack,
    Heading: shadcnComponents.Heading,
    Text: shadcnComponents.Text,
    Badge: shadcnComponents.Badge,
    Table: shadcnComponents.Table,
    Separator: shadcnComponents.Separator,
    GridLayout: ({ props, children }) => {
      const columns = props.columns ?? 1;
      return (
        <div
          className={cn(
            "grid gap-4",
            columns === 1 && "grid-cols-1",
            columns === 2 && "grid-cols-1 md:grid-cols-2",
            columns === 3 && "grid-cols-1 lg:grid-cols-3",
            columns === 4 && "grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
          )}
        >
          {children}
        </div>
      );
    },
    ContextCard: ({ props }) => (
      <UICard className="border border-border/70">
        <CardHeader>
          <CardTitle className="text-xl text-balance">{props.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">{props.summary}</p>
        </CardContent>
      </UICard>
    ),
    StatTile: ({ props }) => (
      <UICard>
        <CardContent className="flex flex-col gap-3 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {props.label}
              </p>
              <p className="mt-1 text-xl font-semibold text-balance">{props.value}</p>
            </div>
            <span
              className={cn(
                "inline-flex min-w-8 items-center justify-center rounded-md border px-2 py-1 text-xs font-medium",
                toneClasses(props.tone),
              )}
            >
              {trendSymbol(props.trend)}
            </span>
          </div>
          {props.detail ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{props.detail}</p>
          ) : null}
        </CardContent>
      </UICard>
    ),
    EvidenceChart: ({ props }) => {
      const chartConfig = Object.fromEntries(
        props.series.map((series) => [
          series.key,
          {
            label: series.label,
            color: series.color,
          },
        ]),
      ) satisfies ChartConfig;

      const tooltipFormatter = (
        value: number | string | readonly (number | string)[] | undefined,
        name: number | string | undefined,
      ) => {
        const num = value == null ? Number.NaN : Number(value);
        const label = name == null ? "" : String(name);
        return (
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono font-medium tabular-nums text-foreground">
              {Number.isFinite(num) ? formatChartValue(props.valueKind, num) : "—"}
            </span>
          </div>
        );
      };

      return (
        <UICard>
          <CardHeader>
            <CardTitle className="text-base">{props.title}</CardTitle>
            {props.description ? (
              <CardDescription className="leading-relaxed">{props.description}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="min-h-[240px] w-full">
              {props.kind === "bar" ? (
                <BarChart accessibilityLayer data={props.points} margin={{ left: 4, right: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis hide tickFormatter={(value) => formatChartValue(props.valueKind, value)} />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent formatter={tooltipFormatter} />}
                  />
                  {props.series.map((series) => (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      fill={`var(--color-${series.key})`}
                      radius={4}
                    />
                  ))}
                </BarChart>
              ) : (
                <LineChart accessibilityLayer data={props.points} margin={{ left: 4, right: 12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis hide tickFormatter={(value) => formatChartValue(props.valueKind, value)} />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent indicator="line" formatter={tooltipFormatter} />}
                  />
                  {props.valueKind === "index" ? (
                    <ReferenceLine y={100} stroke="var(--border)" strokeDasharray="4 4" />
                  ) : null}
                  {props.series.map((series) => (
                    <Line
                      key={series.key}
                      type="monotone"
                      dataKey={series.key}
                      stroke={`var(--color-${series.key})`}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              )}
            </ChartContainer>
          </CardContent>
        </UICard>
      );
    },
    KpiTile: KpiTileComponent,
    KpiGrid: ({ props }) => (
      <UICard>
        <CardHeader>
          <CardTitle className="text-base">Growth pace</CardTitle>
          <CardDescription className="leading-relaxed">
            How fast the underlying business is moving, quarter by quarter. Hover any tile for the
            plain-English meaning.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {props.rows.map((row, index) => (
            <div key={`${row.metricKey}-${index}`}>
              <div className="mb-2 flex items-baseline justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-foreground">{row.metricLabel}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed max-w-prose">
                    {row.metricDescription}
                  </p>
                </div>
                <span className="rounded border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {row.cadence}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <KpiTileComponent
                  key={`${row.metricKey}-latest`}
                  props={{
                    label: row.latest.label,
                    description: row.latest.description,
                    value: row.latest.value,
                    sub: row.latest.period,
                    trend: row.latest.trend,
                    tone: row.latest.tone,
                  }}
                />
                <KpiTileComponent
                  key={`${row.metricKey}-qoq`}
                  props={{
                    label: row.qoq.label,
                    description: row.qoq.description,
                    value: row.qoq.value ?? "—",
                    sub: row.qoq.sub,
                    trend: row.qoq.trend,
                    tone: row.qoq.tone,
                  }}
                />
                <KpiTileComponent
                  key={`${row.metricKey}-yoy`}
                  props={{
                    label: row.yoy.label,
                    description: row.yoy.description,
                    value: row.yoy.value ?? "—",
                    sub: row.yoy.sub,
                    trend: row.yoy.trend,
                    tone: row.yoy.tone,
                  }}
                />
                <KpiTileComponent
                  key={`${row.metricKey}-cagr`}
                  props={{
                    label: row.cagr.label,
                    description: row.cagr.description,
                    value: row.cagr.value ?? "—",
                    sub: row.cagr.sub,
                    trend: "mixed",
                    tone: "neutral",
                  }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </UICard>
    ),
    CagrTable: ({ props }) => (
      <UICard>
        <CardHeader>
          <CardTitle className="text-base">Compound annual growth (CAGR)</CardTitle>
          <CardDescription className="leading-relaxed">
            The smooth yearly growth rate across each window. The "start → end" line shows the
            dollar value at the beginning and end of the window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Metric</th>
                  {props.horizons.map((h) => (
                    <th key={h.label} className="py-2 pr-4 text-right font-medium">
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {props.rows.map((row) => (
                  <tr key={row.metricLabel} className="border-b border-border/60 last:border-b-0">
                    <td className="py-3 pr-4 font-medium text-foreground">{row.metricLabel}</td>
                    {row.cells.map((cell) => (
                      <td key={cell.horizonLabel} className="py-3 pr-4 text-right align-top">
                        <div className="font-semibold tabular-nums text-foreground">
                          {cell.cagr ?? "—"}
                        </div>
                        {cell.startValue != null && cell.endValue != null ? (
                          <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                            <span>{cell.startValue}</span>
                            <span className="mx-1 opacity-60">→</span>
                            <span>{cell.endValue}</span>
                          </div>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </UICard>
    ),
    ValuationCard: ({ props }) => (
      <UICard>
        <CardHeader>
          <CardTitle className="text-base">Valuation — P/E</CardTitle>
          <CardDescription className="leading-relaxed">{props.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  P/E TTM
                </p>
                <span
                  className={cn(
                    "inline-flex min-w-6 items-center justify-center rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums",
                    toneClasses(props.tone),
                  )}
                >
                  {trendSymbol(props.trend)}
                </span>
              </div>
              <p className="text-2xl font-semibold tabular-nums leading-tight">
                {props.ttm != null ? `${props.ttmLabel}×` : "—"}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Trailing twelve months. Today's price divided by the last year of actual earnings.
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  P/E NTM
                </p>
                <span
                  className={cn(
                    "inline-flex min-w-6 items-center justify-center rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums",
                    toneClasses(props.tone),
                  )}
                >
                  {trendSymbol(props.trend)}
                </span>
              </div>
              <p className="text-2xl font-semibold tabular-nums leading-tight">
                {props.ntm != null ? `${props.ntmLabel}×` : "—"}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Next twelve months. Today's price divided by what analysts expect the company to
                earn over the coming year.
              </p>
            </div>
          </div>
        </CardContent>
      </UICard>
    ),
    GrowthChartToggle: ({ props }) => {
      const [mode, setMode] = React.useState<"qoq" | "yoy">(props.mode);
      const seriesKeys = props.series.map((s) => s.key);

      // Compute QoQ / YoY series on the fly from the raw quarterly $ values.
      // Using a derived data set (rather than passing pre-computed points in
      // the spec) keeps the props surface small and avoids any shape mismatch
      // with the chartConfig.
      const buildPoints = (kind: "qoq" | "yoy") => {
        const chartNumber = (value: string | number | null | undefined): number | null => {
          const parsed = z.number().safeParse(value);
          return parsed.success ? parsed.data : null;
        };
        return props.points.map((point, i) => {
          const baseIdx = kind === "qoq" ? i - 1 : i - 4;
          return Object.fromEntries([
            ["label", point.label] as const,
            ...seriesKeys.map((key): [string, number | null] => {
              const cur = chartNumber(point[key]);
              const baseRaw = baseIdx >= 0 ? props.points[baseIdx]?.[key] : undefined;
              const base = chartNumber(baseRaw);
              if (cur == null || base == null || base <= 0) return [key, null];
              return [key, ((cur - base) / base) * 100];
            }),
          ]);
        });
      };
      const points = React.useMemo(() => buildPoints(mode), [mode, props.points]);

      const chartConfig = Object.fromEntries(
        props.series.map((s) => [s.key, { label: s.label, color: s.color }]),
      ) satisfies ChartConfig;

      return (
        <UICard>
          <CardHeader>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base">{props.title}</CardTitle>
                {props.description ? (
                  <CardDescription className="leading-relaxed">{props.description}</CardDescription>
                ) : null}
              </div>
              <div
                role="tablist"
                aria-label="Growth cadence"
                className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5"
              >
                {(["qoq", "yoy"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                      mode === m
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "qoq" ? "QoQ" : "YoY"}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="min-h-[240px] w-full">
              <BarChart accessibilityLayer data={points} margin={{ left: 4, right: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis
                  tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => {
                        const num = value == null ? Number.NaN : Number(value);
                        return (
                          <div className="flex w-full items-center justify-between gap-3">
                            <span className="text-muted-foreground">
                              {name == null ? "" : String(name)}
                            </span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {Number.isFinite(num) ? `${num.toFixed(1)}%` : "—"}
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                {props.series.map((series) => (
                  <Bar
                    key={series.key}
                    dataKey={series.key}
                    fill={`var(--color-${series.key})`}
                    radius={4}
                  />
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </UICard>
      );
    },
    BalanceSheetStrip: ({ props }) => (
      <UICard>
        <CardHeader>
          <CardTitle className="text-base">{props.title}</CardTitle>
          {props.description ? (
            <CardDescription className="leading-relaxed">{props.description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {props.entries.map((entry) => (
              <div key={entry.key} className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {entry.label}
                  </p>
                  <span
                    className={cn(
                      "inline-flex min-w-6 items-center justify-center rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums",
                      toneClasses(entry.tone),
                    )}
                  >
                    {trendSymbol(entry.trend)}
                  </span>
                </div>
                <p className="text-base font-semibold tabular-nums leading-tight">{entry.value}</p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {entry.description}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </UICard>
    ),
    TakeawayList: ({ props }) => (
      <UICard>
        <CardHeader>
          <CardTitle className="text-base">{props.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 pl-4 text-sm leading-relaxed text-muted-foreground list-disc">
            {props.items.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </UICard>
    ),
    MacroThesisCard: ({ props }) => {
      const score = props.opportunityScore;
      const scoreColorClasses =
        score >= 70
          ? "border-emerald-500/50 bg-muted/30"
          : score >= 40
            ? "border-amber-500/50 bg-muted/30"
            : "border-red-500/50 bg-muted/30";
      const scoreTextClasses =
        score >= 70 ? "text-emerald-600" : score >= 40 ? "text-amber-600" : "text-red-600";
      const sCurveLabel = {
        early_adopter: "Early Adopter",
        crossing_chasm: "Crossing Chasm",
        mainstream: "Mainstream",
        mature: "Mature",
      } satisfies Record<string, string>;
      return (
        <UICard className="border-2 border-primary/10 bg-gradient-to-br from-background to-muted/20">
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Long-term thesis
                </p>
                <p className="mt-3 text-lg font-semibold leading-relaxed text-balance">
                  {props.secularBet}
                </p>
              </div>
              <div
                className={cn(
                  "flex flex-col items-center rounded-xl border-2 px-4 py-3 shrink-0",
                  scoreColorClasses,
                )}
              >
                <span className={cn("text-3xl font-bold tabular-nums", scoreTextClasses)}>
                  {score}
                </span>
                <span className="text-xs uppercase tracking-wider text-muted-foreground mt-0.5">
                  opportunity
                </span>
                {props.confidence != null ? (
                  <span className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                    {Math.round(props.confidence)}% thesis conf
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {sCurveLabel[props.sCurvePosition] ?? props.sCurvePosition}
              </span>
              <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {props.timeHorizon} horizon
              </span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {(props.bottleneckRole || props.consensusBlindSpot) && (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {props.bottleneckRole ? (
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                    <p className="text-xs uppercase tracking-wider text-sky-600 mb-2">
                      Bottleneck Role
                    </p>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {props.bottleneckRole}
                    </p>
                  </div>
                ) : null}
                {props.consensusBlindSpot ? (
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                    <p className="text-xs uppercase tracking-wider text-fuchsia-600 mb-2">
                      Consensus Blind Spot
                    </p>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {props.consensusBlindSpot}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
            {/* Demand Gap */}
            <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Demand Gap
              </p>
              <p className="text-sm leading-relaxed text-foreground/80">{props.demandGap}</p>
            </div>
            {props.demandScenarios?.length ? (
              <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  Demand to Equity Scenarios
                </p>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                  {props.demandScenarios.map((scenario, i) => {
                    const label =
                      scenario.case === "bull"
                        ? "Bull"
                        : scenario.case === "bear"
                          ? "Bear"
                          : "Base";
                    return (
                      <div
                        key={`${scenario.case}-${i}`}
                        className="rounded-lg border border-border/60 bg-background/70 p-3"
                      >
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <span className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
                            {label}
                          </span>
                          {scenario.confidence != null ? (
                            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                              {Math.round(scenario.confidence)}% conf
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm font-medium leading-relaxed text-foreground">
                          {scenario.demandDriver}
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-md bg-muted px-2.5 py-2">
                            <p className="uppercase tracking-wider text-muted-foreground">Demand</p>
                            <p className="mt-1 font-semibold text-foreground">
                              {scenario.demandChangePct != null
                                ? `${scenario.demandChangePct > 0 ? "+" : ""}${scenario.demandChangePct.toFixed(0)}%`
                                : "—"}
                            </p>
                          </div>
                          <div className="rounded-md bg-muted px-2.5 py-2">
                            <p className="uppercase tracking-wider text-muted-foreground">
                              Earnings
                            </p>
                            <p className="mt-1 font-semibold text-foreground">
                              {scenario.earningsImpactPct != null
                                ? `${scenario.earningsImpactPct > 0 ? "+" : ""}${scenario.earningsImpactPct.toFixed(0)}%`
                                : "—"}
                            </p>
                          </div>
                          <div className="rounded-md bg-muted px-2.5 py-2 col-span-2">
                            <p className="uppercase tracking-wider text-muted-foreground">
                              Equity implication
                            </p>
                            <p className="mt-1 font-semibold text-foreground">
                              {scenario.equityImpactPct != null
                                ? `${scenario.equityImpactPct > 0 ? "+" : ""}${scenario.equityImpactPct.toFixed(0)}%`
                                : "—"}
                            </p>
                          </div>
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                          {scenario.businessTransmission}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {/* Dependency Chain */}
            {props.dependencyChain.length > 0 && (
              <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  Dependency Chain
                </p>
                <ol className="flex flex-col gap-2.5">
                  {props.dependencyChain.map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {props.repricingTriggers?.length ? (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <p className="text-xs uppercase tracking-wider text-emerald-600 mb-3">
                  Repricing Triggers
                </p>
                <ul className="flex flex-col gap-2 pl-4 list-disc">
                  {props.repricingTriggers.map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground leading-relaxed">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {/* Assumptions + Kill conditions */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {props.loadBearingAssumptions.length > 0 && (
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <p className="text-xs uppercase tracking-wider text-amber-600 mb-3">
                    Must be true
                  </p>
                  <ul className="flex flex-col gap-2 pl-4 list-disc">
                    {props.loadBearingAssumptions.map((item, i) => (
                      <li key={i} className="text-sm text-muted-foreground leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {props.falsificationSignals.length > 0 && (
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <p className="text-xs uppercase tracking-wider text-red-600 mb-3">
                    Thesis broken if
                  </p>
                  <ul className="flex flex-col gap-2 pl-4 list-disc">
                    {props.falsificationSignals.map((item, i) => (
                      <li key={i} className="text-sm text-muted-foreground leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </UICard>
      );
    },
  },
});

export function JsonSpecRenderer({ spec }: { spec: any }) {
  return (
    <StateProvider initialState={{}}>
      <VisibilityProvider>
        <ValidationProvider>
          <ActionProvider handlers={{}}>
            <Renderer spec={spec} registry={registry} />
          </ActionProvider>
        </ValidationProvider>
      </VisibilityProvider>
    </StateProvider>
  );
}

export function buildMacroThesisSpec(thesis: MacroThesis) {
  return {
    root: "macro-thesis-card",
    elements: {
      "macro-thesis-card": {
        type: "MacroThesisCard",
        props: {
          secularBet: thesis.secularBet,
          sCurvePosition: thesis.sCurvePosition,
          timeHorizon: thesis.timeHorizon,
          opportunityScore: normalizeScore(thesis.opportunityScore) ?? thesis.opportunityScore,
          confidence: normalizeScore(thesis.confidence),
          dependencyChain: thesis.dependencyChain,
          bottleneckRole: thesis.bottleneckRole ?? null,
          consensusBlindSpot: thesis.consensusBlindSpot ?? null,
          demandGap: thesis.demandGap,
          demandScenarios: (thesis.demandScenarios ?? []).map((scenario) => ({
            ...scenario,
            confidence: normalizeScore(scenario.confidence) ?? scenario.confidence,
          })),
          repricingTriggers: thesis.repricingTriggers ?? [],
          loadBearingAssumptions: thesis.loadBearingAssumptions,
          falsificationSignals: thesis.falsificationSignals,
        },
      },
    },
  };
}
