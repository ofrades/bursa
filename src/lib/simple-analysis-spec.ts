import type { SimpleAnalysisEvidence } from "./simple-analysis";

interface SpecElement {
  type: string;
  props: unknown;
  children?: string[];
}

interface SpecElements {
  [key: string]: SpecElement;
}

export function buildSimpleAnalysisSpec(evidence: SimpleAnalysisEvidence) {
  // New top-of-page sections: KPI grid + side-by-side quarterly/annual charts
  // + CAGR table + balance sheet strip. All optional on the evidence
  // (backward-compat with old DB rows), so we guard each one.
  const hasKpis = !!evidence.kpiTiles && evidence.kpiTiles.length > 0;
  const hasQuarterlyChart = !!evidence.quarterlyChart;
  const hasAnnualGrowth = !!evidence.annualGrowthChart;
  // We need at least one of the two charts to justify the side-by-side row;
  // otherwise the GridLayout would wrap a single empty child and look broken.
  const hasGrowthRow = hasQuarterlyChart || hasAnnualGrowth;
  const hasCagr = !!evidence.cagrTable && evidence.cagrTable.rows.length > 0;
  const hasValuation = !!evidence.valuationCard;
  const hasBalanceSheet = !!evidence.balanceSheet && evidence.balanceSheet.length > 0;

  const rootChildren: string[] = ["context-card"];
  if (hasKpis) rootChildren.push("kpi-grid");
  if (hasGrowthRow) rootChildren.push("quarterly-row");
  if (hasCagr) rootChildren.push("cagr-table");
  // Valuation card sits right after the CAGR table — i.e. right after the
  // reader has seen Revenue 1Y Growth. The point is: "here's how fast it's
  // growing, and here's what you're paying for that growth."
  if (hasValuation) rootChildren.push("valuation-card");
  if (hasBalanceSheet) rootChildren.push("balance-sheet-strip");
  rootChildren.push("takeaways");

  const elements: SpecElements = {
    root: {
      type: "Stack",
      props: { direction: "vertical", gap: "lg" },
      children: rootChildren,
    },
    "context-card": {
      type: "ContextCard",
      props: {
        title: evidence.title,
        summary: evidence.summary,
      },
    },
    takeaways: {
      type: "TakeawayList",
      props: {
        title: "What stands out",
        items: evidence.takeaways,
      },
    },
  };

  if (hasKpis) {
    elements["kpi-grid"] = {
      type: "KpiGrid",
      props: {
        rows: evidence.kpiTiles!.map((tile) => ({
          metricKey: tile.metric,
          metricLabel: tile.metricLabel,
          metricDescription: tile.metricDescription,
          cadence: tile.cadence,
          latest: {
            label: "Latest",
            value: tile.latest.value,
            period: tile.latest.period,
            description: tile.latest.description,
            trend: tile.latest.trend,
            tone: tile.latest.tone,
          },
          qoq: {
            label: "QoQ",
            value: tile.qoq.value,
            sub: tile.qoq.vs,
            description: tile.qoq.description,
            trend: tile.qoq.trend,
            tone: tile.qoq.tone,
          },
          yoy: {
            label: "YoY",
            value: tile.yoy.value,
            sub: tile.yoy.vs,
            description: tile.yoy.description,
            trend: tile.yoy.trend,
            tone: tile.yoy.tone,
          },
          cagr: {
            label: "CAGR",
            value: tile.cagr.value,
            sub: tile.cagr.since,
            description: tile.cagr.description,
          },
        })),
      },
    };
  }

  if (hasGrowthRow) {
    // Quarterly absolute bars on the left, annual YoY on the right. On wide
    // screens they sit side-by-side; on narrow they stack. If one of the two
    // charts isn't available, the GridLayout still renders with a single child.
    const rowChildren: string[] = [];
    if (hasQuarterlyChart) rowChildren.push("quarterly-chart");
    if (hasAnnualGrowth) rowChildren.push("annual-growth-chart");
    elements["quarterly-row"] = {
      type: "GridLayout",
      props: { columns: rowChildren.length as 1 | 2 },
      children: rowChildren,
    };
    if (hasQuarterlyChart) {
      const qc = evidence.quarterlyChart!;
      elements["quarterly-chart"] = {
        type: "EvidenceChart",
        props: {
          title: qc.title,
          description: qc.description ?? null,
          kind: qc.kind,
          valueKind: qc.valueKind,
          series: qc.series,
          points: qc.points,
        },
      };
    }
    if (hasAnnualGrowth) {
      const ag = evidence.annualGrowthChart!;
      elements["annual-growth-chart"] = {
        type: "EvidenceChart",
        props: {
          title: ag.title,
          description: ag.description ?? null,
          kind: ag.kind,
          valueKind: ag.valueKind,
          series: ag.series,
          points: ag.points,
        },
      };
    }
  }

  if (hasCagr) {
    elements["cagr-table"] = {
      type: "CagrTable",
      props: {
        horizons: evidence.cagrTable!.horizons,
        rows: evidence.cagrTable!.rows.map((row) => ({
          metricLabel: row.metricLabel,
          cells: row.cells.map((cell) => ({
            horizonLabel: cell.horizonLabel,
            cagr: cell.cagr,
            startValue: cell.startValue,
            endValue: cell.endValue,
            startLabel: cell.startLabel,
            endLabel: cell.endLabel,
          })),
        })),
      },
    };
  }

  if (hasValuation) {
    elements["valuation-card"] = {
      type: "ValuationCard",
      props: {
        ttm: evidence.valuationCard!.ttm,
        ntm: evidence.valuationCard!.ntm,
        ttmLabel: evidence.valuationCard!.ttmLabel,
        ntmLabel: evidence.valuationCard!.ntmLabel,
        trend: evidence.valuationCard!.trend,
        tone: evidence.valuationCard!.tone,
        description: evidence.valuationCard!.description,
      },
    };
  }

  if (hasBalanceSheet) {
    elements["balance-sheet-strip"] = {
      type: "BalanceSheetStrip",
      props: {
        title: "Balance sheet & valuation",
        description:
          "The five numbers that decide whether the growth above is safe, sustainable, and reasonably priced. Descriptions on every tile — hover or scroll to read.",
        entries: evidence.balanceSheet!.map((e) => ({
          key: e.key,
          label: e.label,
          value: e.value,
          description: e.description,
          trend: e.trend,
          tone: e.tone,
        })),
      },
    };
  }

  return {
    root: "root",
    elements,
  };
}
