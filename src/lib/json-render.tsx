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

const catalog = defineCatalog(schema, {
  components: {
    Card: shadcnComponentDefinitions.Card,
    Stack: shadcnComponentDefinitions.Stack,
    Heading: shadcnComponentDefinitions.Heading,
    Text: shadcnComponentDefinitions.Text,
    Badge: shadcnComponentDefinitions.Badge,
    Table: shadcnComponentDefinitions.Table,
    Separator: shadcnComponentDefinitions.Separator,
  },
  actions: {},
});

const { registry } = defineRegistry(catalog, {
  components: {
    Card: shadcnComponents.Card,
    Stack: shadcnComponents.Stack,
    Heading: shadcnComponents.Heading,
    Text: shadcnComponents.Text,
    Badge: shadcnComponents.Badge,
    Table: shadcnComponents.Table,
    Separator: shadcnComponents.Separator,
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

export function buildAnalysisSpec(recData: any, metrics?: any, community = false) {
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
            ["WTD", metrics?.perfWtd != null ? `${metrics.perfWtd.toFixed(1)}%` : "—"],
            ["MTD", metrics?.perfMtd != null ? `${metrics.perfMtd.toFixed(1)}%` : "—"],
            ["YTD", metrics?.perfYtd != null ? `${metrics.perfYtd.toFixed(1)}%` : "—"],
            ["Momentum", metrics?.momentumSignal ?? "—"],
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
