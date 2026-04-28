/**
 * Billing helpers.
 * billedCents = ceil(providerCostUsd × usdToEurRate × markupMultiplier × 100)
 * Exchange rate comes from Stripe FX Quotes (see src/lib/fx.ts), fetched per-request.
 */

const DEFAULT_BILLING_MARKUP_MULTIPLIER = 1.8;

export type BillingBreakdown = {
  actualModel: string;
  providerCostUsd: number;
  providerCostEur: number;
  billedCents: number;
  markupMultiplier: number;
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
  };
}

export function calculateBilledCost(input: {
  actualModel: string;
  providerCostUsd: number;
  usdToEurRate: number;
}): BillingBreakdown {
  const providerCostUsd = Math.max(0, input.providerCostUsd);
  const { markupMultiplier } = getBillingConfig();
  const providerCostEur = providerCostUsd * input.usdToEurRate;
  const billedCents =
    providerCostEur <= 0 ? 0 : Math.ceil(providerCostEur * markupMultiplier * 100);

  return {
    actualModel: input.actualModel,
    providerCostUsd,
    providerCostEur,
    billedCents,
    markupMultiplier,
    usdToEurRate: input.usdToEurRate,
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
