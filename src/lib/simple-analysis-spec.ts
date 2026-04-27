import type { SimpleAnalysisEvidence } from "./simple-analysis";

export function buildSimpleAnalysisSpec(evidence: SimpleAnalysisEvidence) {
  const chartIds = evidence.charts.map((_, index) => `chart-${index}`);
  const chartColumns = chartIds.length >= 3 ? 3 : Math.max(chartIds.length, 1);

  const rootChildren = ["context-card", "stats-grid"];
  if (chartIds.length) rootChildren.push("charts-grid");
  rootChildren.push("takeaways");

  const elements: Record<string, any> = {
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
    "stats-grid": {
      type: "GridLayout",
      props: { columns: 4 },
      children: evidence.stats.map((_, index) => `stat-${index}`),
    },
    "charts-grid": {
      type: "GridLayout",
      props: { columns: chartColumns },
      children: chartIds,
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
