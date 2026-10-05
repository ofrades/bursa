import { describe, expect, it } from "vitest";
import { horizonReturn, type PriceBar } from "./outcomes";

function bars(closes: number[], startDate = "2025-01-01"): PriceBar[] {
  return closes.map((adjClose, i) => ({
    date: new Date(Date.parse(startDate) + i * 86400000),
    adjClose,
  }));
}

const RUN_AT = new Date("2025-01-03T14:30:00Z"); // 3rd bar (index 2)

describe("horizonReturn", () => {
  it("enters at the last close on/before the run date, exits horizon sessions later", () => {
    const r = horizonReturn(bars([100, 101, 102, 103, 104, 105]), RUN_AT, 3);
    // entry = 102 (Jan 3), exit = index 2+3 = 105
    expect(r?.priceAtRun).toBe(102);
    expect(r?.priceAtEnd).toBe(105);
    expect(r?.returnPct).toBeCloseTo(105 / 102 - 1, 8);
  });

  it("returns null while the window has not elapsed", () => {
    expect(horizonReturn(bars([100, 101, 102, 103]), RUN_AT, 3)).toBeNull();
  });

  it("returns null when the run predates all bars", () => {
    expect(horizonReturn(bars([100, 101, 102]), new Date("2024-01-01"), 1)).toBeNull();
  });

  it("ignores bars without a usable adjusted close", () => {
    const series = bars([100, 101, 102, 103, 104, 105]);
    series[3].adjClose = null;
    // filtered series: 100,101,102,104,105 -> entry 102 (idx2), exit idx4=105
    const r = horizonReturn(series, RUN_AT, 2);
    expect(r?.priceAtRun).toBe(102);
    expect(r?.priceAtEnd).toBe(105);
  });

  it("returns null when a missing bar shortens the window", () => {
    const series = bars([100, 101, 102, 103, 104, 105]);
    series[3].adjClose = null;
    expect(horizonReturn(series, RUN_AT, 3)).toBeNull();
  });
});
