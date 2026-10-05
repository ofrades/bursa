import { describe, expect, it } from "vitest";
import { readRevision, readStatements } from "./data";

describe("consensus revision inputs", () => {
  it("computes same-period positive-EPS revisions and retains the fiscal target", () => {
    const revision = readRevision({
      endDate: "2026-12-31",
      epsTrend: { current: 11, "90daysAgo": 10 },
      earningsEstimate: { avg: 11, yearAgoEps: 10 },
    });
    expect(revision.revision).toBeCloseTo(0.1);
    expect(revision.epsGrowth).toBeCloseTo(0.1);
    expect(revision).toMatchObject({ targetDate: "2026-12-31", current: 11, previous: 10 });
  });
  it("does not reverse loss improvements or compare EPS through zero", () => {
    expect(readRevision({ epsTrend: { current: -1, "90daysAgo": -2 } }).revision).toBeNull();
    expect(readRevision({ epsTrend: { current: 1, "90daysAgo": 0 } }).revision).toBeNull();
    expect(readRevision(undefined).revision).toBeNull();
  });
});

describe("statement alignment", () => {
  it("uses the same two fiscal dates and resolves shares per date", () => {
    const fiscal = readStatements({
      annualTotalAssets: [
        { date: "2025-12-31", value: 1000 },
        { date: "2024-12-31", value: 900 },
      ],
      annualNetIncome: [
        { date: "2024-12-31", value: 50 },
        { date: "2023-12-31", value: 40 },
      ],
      annualShareIssued: [
        { date: "2025-12-31", value: 100 },
        { date: "2024-12-31", value: 100 },
      ],
    });
    expect(fiscal.statements.netIncome).toEqual([null, 50]);
    expect(fiscal.statements.sharesOutstanding).toEqual([100, 100]);
    expect(fiscal.date).toBe("2025-12-31");
  });
  it("does not assume a missing debt component is zero", () => {
    const fiscal = readStatements({
      annualTotalAssets: [{ date: "2025-12-31", value: 1000 }],
      annualLongTermDebt: [{ date: "2025-12-31", value: 50 }],
    });
    expect(fiscal.statements.totalDebt).toBeNull();
  });
});
