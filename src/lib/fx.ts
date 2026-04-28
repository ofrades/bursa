/**
 * Live USD→EUR exchange rate via Stripe FX Quotes API (replaces deprecated exchangeRates).
 * Uses lock_duration: 'none' (current rate, no fee) and base_rate (excludes Stripe FX fee).
 * Falls back to 0.92 if Stripe is unreachable or not configured.
 */

const FALLBACK_RATE = 0.92;

export async function getUsdToEurRate(): Promise<number> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return FALLBACK_RATE;

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(key, { apiVersion: "2026-04-22.preview" });
    const quote = await stripe.fxQuotes.create({
      to_currency: "eur",
      from_currencies: ["usd"],
      lock_duration: "none",
    });
    const rate = quote.rates["usd"]?.rate_details?.base_rate;
    if (rate && rate > 0) return rate;
  } catch {
    // Stripe unreachable — use fallback
  }

  return FALLBACK_RATE;
}
