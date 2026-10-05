import { afterEach, describe, expect, it, vi } from "vitest";
import { getRevisionSummary } from "./market-data";

afterEach(() => vi.unstubAllGlobals());

describe("free consensus source", () => {
  it("reads the plain-text crumb and normalizes actual REST numeric wrappers", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html></html>", { headers: { "set-cookie": "A=fixture" } }),
      )
      .mockResolvedValueOnce(new Response("fixture-crumb"))
      .mockResolvedValueOnce(
        Response.json({
          quoteSummary: {
            result: [
              {
                price: { currency: "EUR", marketCap: { raw: 80e9, fmt: "80B" } },
                financialData: { numberOfAnalystOpinions: { raw: 25 } },
                earningsTrend: {
                  trend: [
                    {
                      period: "0y",
                      endDate: "2026-12-31",
                      epsTrend: { current: { raw: 11 }, "90daysAgo": { raw: 10 } },
                      epsRevisions: { upLast30days: { raw: 10 }, downLast30days: { raw: 2 } },
                    },
                  ],
                },
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const summary = await getRevisionSummary("SAP.DE");
    expect(summary.price?.marketCap).toBe(80e9);
    expect(summary.financialData?.numberOfAnalystOpinions).toBe(25);
    expect(summary.earningsTrend?.trend?.[0].epsTrend?.current).toBe(11);
    expect(fetch.mock.calls[2][0]).toContain("crumb=fixture-crumb");
  });

  it("surfaces a source outage instead of returning a healthy-looking empty summary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })));
    await expect(getRevisionSummary("X")).rejects.toThrow("Yahoo request failed: 403");
  });
});
