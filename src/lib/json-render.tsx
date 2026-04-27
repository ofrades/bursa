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
import type { SimpleAnalysisEvidence, ValueKind } from "./simple-analysis";
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
    VerdictCard: {
      props: z.object({
        status: z.enum(["good", "watch", "avoid"]),
        headline: z.string(),
        summary: z.string(),
      }),
      description: "Plain-language verdict card",
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

function statusClasses(status: "good" | "watch" | "avoid") {
  switch (status) {
    case "good":
      return "border-emerald-200/80 dark:border-emerald-800/50";
    case "avoid":
      return "border-red-200/80 dark:border-red-800/50";
    default:
      return "border-amber-200/80 dark:border-amber-800/50";
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
            columns === 3 && "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
            columns === 4 && "grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
          )}
        >
          {children}
        </div>
      );
    },
    VerdictCard: ({ props }) => (
      <UICard className={cn("border", statusClasses(props.status))}>
        <CardHeader>
          <CardDescription className="text-xs uppercase tracking-wider">
            Simple view
          </CardDescription>
          <CardTitle className="text-xl text-balance">{props.headline}</CardTitle>
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
          <CardDescription>Short plain-English reasons behind the view.</CardDescription>
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
            ["Weekly outlook", recData?.weeklyOutlook ?? "—"],
            ["Risk", recData?.riskLevel ?? "—"],
            ["Price target", recData?.priceTarget != null ? `$${recData.priceTarget}` : "—"],
            ["Stop loss", recData?.stopLoss != null ? `$${recData.stopLoss}` : "—"],
            ["Weekly trend", recData?.weeklyTrend ?? "—"],
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

export function buildSimpleAnalysisSpec(evidence: SimpleAnalysisEvidence) {
  const topChartIds = evidence.charts.slice(0, 2).map((_, index) => `chart-${index}`);
  const bottomChartIds = evidence.charts.slice(2).map((_, index) => `chart-${index + 2}`);

  const rootChildren = ["verdict", "stats-grid"];
  if (topChartIds.length) rootChildren.push("charts-grid-top");
  if (bottomChartIds.length) rootChildren.push("charts-stack-bottom");
  rootChildren.push("takeaways");

  const elements: Record<string, any> = {
    root: {
      type: "Stack",
      props: { direction: "vertical", gap: "lg" },
      children: rootChildren,
    },
    verdict: {
      type: "VerdictCard",
      props: {
        status: evidence.status,
        headline: evidence.headline,
        summary: evidence.summary,
      },
    },
    "stats-grid": {
      type: "GridLayout",
      props: { columns: 4 },
      children: evidence.stats.map((_, index) => `stat-${index}`),
    },
    "charts-grid-top": {
      type: "GridLayout",
      props: { columns: 2 },
      children: topChartIds,
    },
    "charts-stack-bottom": {
      type: "Stack",
      props: { direction: "vertical", gap: "md" },
      children: bottomChartIds,
    },
    takeaways: {
      type: "TakeawayList",
      props: {
        title: "What stands out",
        items: evidence.takeaways,
      },
    },
  };

  evidence.stats.forEach((stat, index) => {
    elements[`stat-${index}`] = {
      type: "StatTile",
      props: stat,
    };
  });

  evidence.charts.forEach((chart, index) => {
    elements[`chart-${index}`] = {
      type: "EvidenceChart",
      props: chart,
    };
  });

  return {
    root: "root",
    elements,
  };
}
