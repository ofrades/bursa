import { describe, expect, it } from "vitest";

import { cagr, horizonCagr, qoqGrowth, yoyGrowth } from "./simple-analysis";

describe("cagr", () => {
  it("computes the geometric annualised growth rate", () => {
    // 100 → 200 over 1 year = 100%
    expect(cagr(100, 200, 1)).toBeCloseTo(100, 6);
    // 100 → 400 over 2 years = 100% per year
    expect(cagr(100, 400, 2)).toBeCloseTo(100, 6);
    // 26.9 → 215.9 over 3 years (NVDA reference) ≈ 100%
    expect(cagr(26.9, 215.9, 3)).toBeCloseTo(100, 0);
  });

  it("returns null for degenerate inputs", () => {
    expect(cagr(0, 100, 1)).toBeNull();
    expect(cagr(-10, 100, 1)).toBeNull();
    expect(cagr(100, -10, 1)).toBeNull();
    expect(cagr(100, 200, 0)).toBeNull();
    expect(cagr(NaN, 200, 1)).toBeNull();
  });
});

describe("qoqGrowth", () => {
  it("returns per-point QoQ growth with the first point as null", () => {
    expect(qoqGrowth([100, 110, 121])).toEqual([null, 10, 10]);
  });

  it("handles decreases and missing values", () => {
    expect(qoqGrowth([100, 80, null, 90])).toEqual([null, -20, null, null]);
  });
});

describe("yoyGrowth", () => {
  it("returns YoY growth only when 4 prior points exist", () => {
    // Index 0..3: null (no YoY base). Index 4: series[0]→series[4] = 100→150 = +50%
    // Index 5: series[1]→series[5] = 110→165 = +50%
    const series = [100, 110, 105, 115, 150, 165];
    expect(yoyGrowth(series)).toEqual([null, null, null, null, 50, 50]);
  });
});

describe("horizonCagr", () => {
  it("uses the first point within the window as the baseline", () => {
    // 5 annual points. With years=3, the cutoff from 2024-12-31 is 2021-12-31,
    // so the 3-year window is 2021 → 2024 (3.00 years).
    const points = [
      { label: "2020", date: "2020-12-31", value: 100 },
      { label: "2021", date: "2021-12-31", value: 110 },
      { label: "2022", date: "2022-12-31", value: 121 },
      { label: "2023", date: "2023-12-31", value: 133 },
      { label: "2024", date: "2024-12-31", value: 146 },
    ];
    const result = horizonCagr(points, 3);
    expect(result).not.toBeNull();
    // Window: 2021 → 2024 (3 years), 110 → 146.
    expect(result!.startLabel).toBe("2021");
    expect(result!.endLabel).toBe("2024");
    expect(result!.start).toBe(110);
    expect(result!.end).toBe(146);
    // (146/110)^(1/3) - 1 ≈ 9.85%
    expect(result!.cagr).toBeCloseTo(9.85, 1);
  });

  it("returns null when the data does not cover the requested window", () => {
    // Regression: when the only data we have is a single Q1'24 → Q1'25 pair,
    // the 1y window covers it but the 2y/3y windows don't have 2 in-window
    // points. The old fallback used the oldest available point and made every
    // column collapse onto the same single-period rate. We now bail out so
    // the UI can show "—" and the user can tell what we actually have.
    const points = [
      { label: "Q1 2024", date: "2024-03-31", value: 479.1 },
      { label: "Q1 2025", date: "2025-03-31", value: 639.8 },
    ];
    // 1y window: both points in range, real CAGR.
    const oneYear = horizonCagr(points, 1);
    expect(oneYear).not.toBeNull();
    expect(oneYear!.startLabel).toBe("Q1 2024");
    expect(oneYear!.endLabel).toBe("Q1 2025");
    // (639.8/479.1)^(1/1) - 1 ≈ 33.54%
    expect(oneYear!.cagr).toBeCloseTo(33.54, 1);
    // 2y / 3y windows: only 1 point in range → null, not a fake number.
    expect(horizonCagr(points, 2)).toBeNull();
    expect(horizonCagr(points, 3)).toBeNull();
  });

  it("returns null for sparse / negative data", () => {
    expect(horizonCagr([], 3)).toBeNull();
    expect(horizonCagr([{ label: "x", date: "2024-12-31", value: 100 }], 3)).toBeNull();
    expect(
      horizonCagr(
        [
          { label: "2020", date: "2020-12-31", value: 0 },
          { label: "2024", date: "2024-12-31", value: 100 },
        ],
        3,
      ),
    ).toBeNull();
  });
});
