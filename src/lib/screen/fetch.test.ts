import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PARAMS } from "./compute";
import { fetchScreenData } from "./fetch";
import {
  getRevisionSummary,
  getRevisionPrices,
  getFundamentalsTimeSeries,
  getEarningsSurprises,
} from "../market-data";

vi.mock("../market-data", () => ({
  getRevisionSummary: vi.fn(),
  getRevisionPrices: vi.fn(),
  getFundamentalsTimeSeries: vi.fn(),
  getEarningsSurprises: vi.fn().mockResolvedValue([]),
  getMarketQuote: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("screen data collection", () => {
  it("records real consensus inputs, fiscal dates and fetch time", async () => {
    vi.mocked(getEarningsSurprises).mockResolvedValue([]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T06:00:00Z"));
    vi.mocked(getRevisionSummary).mockResolvedValue({
      price: { currency: "EUR", marketCap: 80e9 },
      earningsTrend: {
        trend: [
          { period: "0y", endDate: "2026-12-31", epsTrend: { current: 11, "90daysAgo": 10 } },
          { period: "+1y", endDate: "2027-12-31", epsTrend: { current: 12, "90daysAgo": 11 } },
        ],
      },
    });
    vi.mocked(getRevisionPrices).mockResolvedValue(
      Array.from({ length: 280 }, (_, i) => ({
        date: new Date(Date.now() - (279 - i) * 86400000),
        close: 100 + i,
        adjClose: 100 + i,
        volume: 1e6,
      })),
    );
    vi.mocked(getFundamentalsTimeSeries).mockResolvedValue({
      annualTotalAssets: [
        { date: "2026-06-30", value: 1000 },
        { date: "2025-06-30", value: 900 },
      ],
    });
    const fetched = await fetchScreenData("X", DEFAULT_PARAMS);
    expect(fetched.snapshot.fy1.current).toBe(11);
    expect(fetched.snapshot.fy2.targetDate).toBe("2027-12-31");
    expect(fetched.snapshot.statementDate).toBe("2026-06-30");
    expect(fetched.snapshot.source).toBe("Yahoo Finance");
    expect(fetched.data.mom121).not.toBeNull();
    expect(fetched.issues).toContain(
      "Estimate update timestamps are not provided; freshness is unverified.",
    );
  });
});
