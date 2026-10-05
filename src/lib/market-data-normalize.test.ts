import { describe, expect, it } from "vitest";
import { normalizeFundamentals, revisionSummarySchema, unwrapYahoo } from "./market-data-normalize";

describe("Yahoo response boundaries", () => {
  it("accepts EPS currency metadata and explicit empty numeric values", () => {
    const parsed = revisionSummarySchema.parse(
      unwrapYahoo({
        summaryDetail: { forwardPE: {} },
        earningsTrend: {
          trend: [
            {
              period: "0q",
              epsTrend: { current: {}, "90daysAgo": {}, epsTrendCurrency: "EUR" },
              growth: {},
            },
            {
              period: "0y",
              epsTrend: { current: { raw: 11 }, "90daysAgo": { raw: 10 }, epsTrendCurrency: "EUR" },
            },
          ],
        },
      }),
    );
    expect(parsed.summaryDetail?.forwardPE).toBeNull();
    expect(parsed.earningsTrend?.trend?.[0].epsTrend?.current).toBeNull();
    expect(parsed.earningsTrend?.trend?.[1].epsTrend).toMatchObject({
      current: 11,
      "90daysAgo": 10,
      epsTrendCurrency: "EUR",
    });
  });
  it("unwraps nested numeric fields without losing strings, nulls or arrays", () => {
    expect(
      unwrapYahoo({
        price: { marketCap: { raw: 40e9, fmt: "40B" }, currency: "EUR" },
        trend: [{ current: { raw: 5 } }],
        missing: null,
      }),
    ).toEqual({
      price: { marketCap: 40e9, currency: "EUR" },
      trend: [{ current: 5 }],
      missing: null,
    });
  });

  it("reads all named timeseries results, not just the first", () => {
    const payload = {
      timeseries: {
        result: [
          { annualEBIT: [{ asOfDate: "2025-12-31", reportedValue: { raw: 100 } }] },
          { annualTotalAssets: [{ asOfDate: "2025-12-31", reportedValue: { raw: 1000 } }] },
        ],
      },
    };
    const series = normalizeFundamentals(payload, ["annualEBIT", "annualTotalAssets"], {});
    expect(series.annualEBIT[0].reportedValue.raw).toBe(100);
    expect(series.annualTotalAssets[0].reportedValue.raw).toBe(1000);
  });

  it("demultiplexes merged rows by data ID", () => {
    const payload = {
      timeseries: {
        result: [
          {
            "annualEBIT,annualTotalAssets": [
              { asOfDate: "2025-12-31", dataId: 20189, reportedValue: { raw: 100 } },
              { asOfDate: "2025-12-31", dataId: 23220, reportedValue: { raw: 1000 } },
            ],
          },
        ],
      },
    };
    const series = normalizeFundamentals(payload, ["annualEBIT", "annualTotalAssets"], {
      20189: "annualEBIT",
      23220: "annualTotalAssets",
    });
    expect(series.annualEBIT).toHaveLength(1);
    expect(series.annualTotalAssets).toHaveLength(1);
  });

  it("reads a single requested line without inventing a data ID", () => {
    const payload = {
      timeseries: {
        result: [
          { annualCapitalExpenditure: [{ asOfDate: "2025-12-31", reportedValue: { raw: -20 } }] },
        ],
      },
    };
    expect(
      normalizeFundamentals(payload, ["annualCapitalExpenditure"], {}).annualCapitalExpenditure[0]
        .reportedValue.raw,
    ).toBe(-20);
  });
});
