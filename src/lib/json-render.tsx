import { defineCatalog } from "@json-render/core";
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
    MacroThesisCard: {
      props: z.object({
        secularBet: z.string(),
        sCurvePosition: z.enum(["early_adopter", "crossing_chasm", "mainstream", "mature"]),
        timeHorizon: z.enum(["2y", "5y", "10y+"]),
        opportunityScore: z.number().min(0).max(100),
        confidence: z.number().min(0).max(100).nullable().optional(),
        dependencyChain: z.array(z.string()),
        demandGap: z.string(),
        loadBearingAssumptions: z.array(z.string()),
        falsificationSignals: z.array(z.string()),
      }),
      description:
        "Macro opportunity thesis cornerstone card — secular bet, dependency chain, demand gap, S-curve position, assumptions, kill conditions",
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

      const tooltipFormatter = (value: unknown, name: unknown) => {
        const num = typeof value === "number" ? value : Number(value);
        const label = typeof name === "string" ? name : String(name ?? "");
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
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700/50 dark:bg-muted/30"
          : score >= 40
            ? "border-amber-300 bg-amber-50 dark:border-amber-700/50 dark:bg-muted/30"
            : "border-red-300 bg-red-50 dark:border-red-700/50 dark:bg-muted/30";
      const scoreTextClasses =
        score >= 70
          ? "text-emerald-700 dark:text-emerald-300"
          : score >= 40
            ? "text-amber-700 dark:text-amber-300"
            : "text-red-700 dark:text-red-300";
      const sCurveLabel: Record<string, string> = {
        early_adopter: "Early Adopter",
        crossing_chasm: "Crossing Chasm",
        mainstream: "Mainstream",
        mature: "Mature",
      };
      return (
        <UICard className="border-2 border-primary/10 bg-gradient-to-br from-background to-muted/20">
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Macro Thesis · Cornerstone
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
                {typeof props.confidence === "number" ? (
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
            {/* Demand Gap */}
            <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Demand Gap
              </p>
              <p className="text-sm leading-relaxed text-foreground/80">{props.demandGap}</p>
            </div>
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
            {/* Assumptions + Kill conditions */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {props.loadBearingAssumptions.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-3">
                    Must be true
                  </p>
                  <ul className="flex flex-col gap-2 pl-4 list-disc">
                    {props.loadBearingAssumptions.map((item, i) => (
                      <li
                        key={i}
                        className="text-sm text-amber-900 dark:text-muted-foreground leading-relaxed"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {props.falsificationSignals.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-800/40 dark:bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wider text-red-700 dark:text-red-400 mb-3">
                    Thesis broken if
                  </p>
                  <ul className="flex flex-col gap-2 pl-4 list-disc">
                    {props.falsificationSignals.map((item, i) => (
                      <li
                        key={i}
                        className="text-sm text-red-900 dark:text-muted-foreground leading-relaxed"
                      >
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

export function buildAnalysisSpec(recData: any, community = false) {
  const bullishRows = (recData?.keyBullishFactors ?? []).map((x: string) => [x]);
  const bearishRows = (recData?.keyBearishFactors ?? []).map((x: string) => [x]);

  return {
    root: "root-card",
    elements: {
      "root-card": {
        type: "Card",
        props: {
          title: "AI Recommendation",
          description: community ? "Shared by the community" : "Your stock analysis",
          maxWidth: "full",
        },
        children: ["stack-main"],
      },
      "stack-main": {
        type: "Stack",
        props: { direction: "vertical", gap: "md" },
        children: [
          "summary-heading",
          "summary-text",
          "meta-table",
          "sep-1",
          "bull-heading",
          "bull-table",
          "bear-heading",
          "bear-table",
        ],
      },
      "summary-heading": {
        type: "Heading",
        props: {
          text: `${recData?.signal ?? "HOLD"} · ${recData?.confidence ?? 0}% confidence`,
          level: "h3",
        },
      },
      "summary-text": {
        type: "Text",
        props: { text: recData?.reasoning ?? "No reasoning yet.", variant: "body" },
      },
      "meta-table": {
        type: "Table",
        props: {
          columns: ["Metric", "Value"],
          rows: [
            ["Outlook", recData?.weeklyOutlook ?? "—"],
            ["Risk", recData?.riskLevel ?? "—"],
            ["Price target", recData?.priceTarget != null ? `$${recData.priceTarget}` : "—"],
            ["Stop loss", recData?.stopLoss != null ? `$${recData.stopLoss}` : "—"],
            ["Trend", recData?.weeklyTrend ?? "—"],
            [
              "Pullback to 21 EMA",
              recData?.pullbackTo21EMA === true
                ? "Yes"
                : recData?.pullbackTo21EMA === false
                  ? "No"
                  : "—",
            ],
            [
              "Consolidation breakout",
              recData?.consolidationBreakout21EMA === true
                ? "Yes"
                : recData?.consolidationBreakout21EMA === false
                  ? "No"
                  : "—",
            ],
          ],
        },
      },
      "sep-1": { type: "Separator", props: { orientation: "horizontal" } },
      "bull-heading": { type: "Heading", props: { text: "Bullish factors", level: "h4" } },
      "bull-table": {
        type: "Table",
        props: { columns: ["Item"], rows: bullishRows.length ? bullishRows : [["—"]] },
      },
      "bear-heading": { type: "Heading", props: { text: "Bearish factors", level: "h4" } },
      "bear-table": {
        type: "Table",
        props: { columns: ["Item"], rows: bearishRows.length ? bearishRows : [["—"]] },
      },
    },
  };
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
          opportunityScore: thesis.opportunityScore,
          confidence: thesis.confidence ?? null,
          dependencyChain: thesis.dependencyChain,
          demandGap: thesis.demandGap,
          loadBearingAssumptions: thesis.loadBearingAssumptions,
          falsificationSignals: thesis.falsificationSignals,
        },
      },
    },
  };
}
