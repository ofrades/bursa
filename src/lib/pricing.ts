/**
 * Billing helpers.
 * We bill from OpenRouter's actual per-request reported cost, then apply our markup.
 */

const DEFAULT_BILLING_MARKUP_MULTIPLIER = 1.8;
const DEFAULT_BILLING_MIN_CENTS = 2;
const DEFAULT_USD_TO_EUR_RATE = 0.92;

export type BillingBreakdown = {
  actualModel: string;
  providerCostUsd: number;
  providerCostEur: number;
  billedCents: number;
  markupMultiplier: number;
  minimumChargeCents: number;
  usdToEurRate: number;
};

function getNumericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getBillingConfig() {
  return {
    markupMultiplier: getNumericEnv("BILLING_MARKUP_MULTIPLIER", DEFAULT_BILLING_MARKUP_MULTIPLIER),
    minimumChargeCents: Math.max(
      1,
      Math.round(getNumericEnv("BILLING_MIN_CENTS", DEFAULT_BILLING_MIN_CENTS)),
    ),
    usdToEurRate: getNumericEnv("BILLING_USD_TO_EUR", DEFAULT_USD_TO_EUR_RATE),
  };
}

export function calculateBilledCost(input: {
  actualModel: string;
  providerCostUsd: number;
}): BillingBreakdown {
  const providerCostUsd = Math.max(0, input.providerCostUsd);
  const { markupMultiplier, minimumChargeCents, usdToEurRate } = getBillingConfig();
  const providerCostEur = providerCostUsd * usdToEurRate;
  const rawBilledEur = providerCostEur * markupMultiplier;
  const billedCents =
    rawBilledEur <= 0 ? 0 : Math.max(minimumChargeCents, Math.ceil(rawBilledEur * 100));

  return {
    actualModel: input.actualModel,
    providerCostUsd,
    providerCostEur,
    billedCents,
    markupMultiplier,
    minimumChargeCents,
    usdToEurRate,
  };
}

export function formatEuro(cents: number): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(cents / 100);
}
