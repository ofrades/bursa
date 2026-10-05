import { z } from "zod";

const FX_URL = "https://open.er-api.com/v6/latest/EUR";
const REQUIRED_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "SEK",
  "DKK",
  "NOK",
  "JPY",
  "CNY",
  "HKD",
  "TWD",
  "KRW",
  "INR",
  "CAD",
  "AUD",
  "BRL",
  "SAR",
];
const MAX_AGE_MS = 72 * 3600000;
const MAX_CLOCK_SKEW_MS = 5 * 60000;

export type FxRates = Record<string, number>;
const ratesSchema = z.record(z.string(), z.number().finite().positive());
const responseSchema = z.object({
  result: z.literal("success"),
  base_code: z.literal("EUR"),
  time_last_update_unix: z.number().int().positive(),
  rates: ratesSchema,
});

export class FxCoverageError extends Error {
  constructor(message: string) {
    super(
      `FX data unavailable: ${message}. Screening is blocked, not treated as a stock rejection.`,
    );
    this.name = "FxCoverageError";
  }
}

export function requireFxCoverage(
  rates: FxRates,
  currencies: readonly string[] = REQUIRED_CURRENCIES,
): void {
  const missing = [...new Set(currencies.map((c) => (c === "GBp" ? "GBP" : c)))].filter(
    (c) => !Number.isFinite(rates[c]) || rates[c] <= 0,
  );
  if (missing.length)
    throw new FxCoverageError(`missing or invalid rates for ${missing.join(", ")}`);
  if (rates.EUR !== 1) throw new FxCoverageError("EUR base rate must equal 1");
}

const metadataSchema = z.object({
  fx: z.object({ source: z.literal("https://www.exchangerate-api.com"), asOf: z.iso.datetime() }),
});

function requireFxTimestamp(updatedAt: number) {
  const age = Date.now() - updatedAt;
  if (!Number.isFinite(updatedAt) || age > MAX_AGE_MS || age < -MAX_CLOCK_SKEW_MS)
    throw new FxCoverageError("exchange-rate timestamp is stale or in the future");
}

export function readFxRates(snapshot: string | null, params: string): FxRates {
  let payload;
  let metadata;
  try {
    payload = JSON.parse(snapshot ?? "null");
    metadata = JSON.parse(params);
  } catch {
    throw new FxCoverageError("invalid stored rate snapshot");
  }
  const parsed = ratesSchema.safeParse(payload);
  if (!parsed.success) throw new FxCoverageError("invalid stored rate snapshot");
  requireFxCoverage(parsed.data);
  const meta = metadataSchema.safeParse(metadata);
  if (!meta.success)
    throw new FxCoverageError("stored FX source or timestamp is missing or invalid");
  requireFxTimestamp(Date.parse(meta.data.fx.asOf));
  return parsed.data;
}

export async function fetchFxRates() {
  const response = await fetch(FX_URL, { signal: AbortSignal.timeout(30000) }).catch(() => {
    throw new FxCoverageError("exchange-rate source could not be reached");
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new FxCoverageError(`exchange-rate source returned HTTP ${response.status}`);
  }
  const payload = await response.json().catch(() => null);
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success)
    throw new FxCoverageError("exchange-rate response is invalid or has the wrong base");
  const { rates, time_last_update_unix } = parsed.data;
  const updatedAt = time_last_update_unix * 1000;
  requireFxTimestamp(updatedAt);
  requireFxCoverage(rates);
  return {
    rates,
    source: "https://www.exchangerate-api.com",
    asOf: new Date(updatedAt).toISOString(),
  };
}
