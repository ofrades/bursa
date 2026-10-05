import { describe, expect, it } from "vitest";
import { compareRuns } from "./report";

describe("completed snapshot comparisons", () => {
  it("reports entrants, exits and changes without requiring exits to still survive", () => {
    const report = compareRuns(
      [
        { symbol: "A", strict: true, revAvg: 0.12, composite: 1.2 },
        { symbol: "B", strict: false, revAvg: null, composite: null },
      ],
      [
        { symbol: "A", strict: false, revAvg: 0.1, composite: 1 },
        { symbol: "B", strict: true, revAvg: 0.2, composite: 1.5 },
      ],
    );
    expect(report.entered).toEqual(["A"]);
    expect(report.exited).toEqual(["B"]);
    expect(report.changes.A.revision).toBeCloseTo(0.02);
    expect(report.changes.A.composite).toBeCloseTo(0.2);
    expect(report.changes.B.revision).toBeNull();
  });
});
