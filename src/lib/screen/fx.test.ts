import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFxRates, FxCoverageError, readFxRates, requireFxCoverage } from "./fx";

const rates = {
  EUR: 1,
  USD: 1.125,
  GBP: 0.85,
  CHF: 0.94,
  SEK: 11,
  DKK: 7.46,
  NOK: 11.5,
  JPY: 178,
  CNY: 8,
  HKD: 8.8,
  TWD: 36,
  KRW: 1500,
  INR: 95,
  CAD: 1.55,
  AUD: 1.75,
  BRL: 6,
  SAR: 4.22,
};
const now = Date.parse("2026-10-05T06:00:00Z");
const payload = {
  result: "success",
  base_code: "EUR",
  time_last_update_unix: now / 1000 - 3600,
  rates,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type ResponseFixture = {
  result?: string;
  base_code?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number | null>;
};
function respond(body: ResponseFixture, status = 200) {
  const request = vi.fn().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal("fetch", request);
  return request;
}

describe("complete EUR-based FX snapshots", () => {
  it("uses one free request and preserves units per EUR without cross-rate inversion", async () => {
    const request = respond(payload);
    const snapshot = await fetchFxRates();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("https://open.er-api.com/v6/latest/EUR");
    expect(snapshot.rates).toEqual(rates);
    expect(snapshot.source).toBe("https://www.exchangerate-api.com");
    expect(snapshot.asOf).toBe("2026-10-05T05:00:00.000Z");
  });

  it("rejects partial coverage rather than silently returning EUR only", async () => {
    respond({ ...payload, rates: { EUR: 1 } });
    await expect(fetchFxRates()).rejects.toThrow("missing or invalid rates for USD, GBP");
  });

  it.each([0, -1, null])("rejects an invalid USD rate: %s", async (USD) => {
    respond({ ...payload, rates: { ...rates, USD } });
    await expect(fetchFxRates()).rejects.toBeInstanceOf(FxCoverageError);
  });

  it("rejects non-EUR bases and incorrect EUR=1", async () => {
    respond({ ...payload, base_code: "USD" });
    await expect(fetchFxRates()).rejects.toBeInstanceOf(FxCoverageError);
    respond({ ...payload, rates: { ...rates, EUR: 0.9 } });
    await expect(fetchFxRates()).rejects.toThrow("EUR base rate must equal 1");
  });

  it.each([-73 * 3600, 3600])(
    "rejects stale or future provider timestamps: %s seconds",
    async (offset) => {
      respond({ ...payload, time_last_update_unix: now / 1000 + offset });
      await expect(fetchFxRates()).rejects.toThrow("timestamp is stale or in the future");
    },
  );

  it("surfaces network, HTTP and provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(fetchFxRates()).rejects.toThrow("source could not be reached");
    respond({}, 429);
    await expect(fetchFxRates()).rejects.toThrow("HTTP 429");
    respond({ result: "error" });
    await expect(fetchFxRates()).rejects.toBeInstanceOf(FxCoverageError);
  });

  it("validates persisted maps and pence aliases before any evaluation", () => {
    const params = JSON.stringify({
      fx: { source: "https://www.exchangerate-api.com", asOf: new Date(now).toISOString() },
    });
    expect(readFxRates(JSON.stringify(rates), params)).toEqual(rates);
    expect(() => readFxRates('{"EUR":1}', params)).toThrow(FxCoverageError);
    expect(() => readFxRates("not JSON", params)).toThrow(FxCoverageError);
    const stale = JSON.stringify({
      fx: {
        source: "https://www.exchangerate-api.com",
        asOf: new Date(now - 73 * 3600000).toISOString(),
      },
    });
    expect(() => readFxRates(JSON.stringify(rates), stale)).toThrow("stale");
    expect(() => readFxRates(JSON.stringify(rates), "{}")).toThrow("stored FX source or timestamp");
    expect(() => requireFxCoverage(rates, ["GBp", "USD"])).not.toThrow();
    expect(() => requireFxCoverage(rates, ["XYZ"])).toThrow("XYZ");
  });
});
