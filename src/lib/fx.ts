/**
 * Live USD→EUR exchange rate via Stripe FX Quotes API (replaces deprecated exchangeRates).
 * Uses lock_duration: 'none' (current rate, no fee) and base_rate (excludes Stripe FX fee).
 * Falls back to 0.92 if Stripe is unreachable or not configured.
 */

import { Effect, Layer } from "effect";
import { Secrets } from "./effect/services/secrets";
import { StripeGateway } from "./effect/services/stripe";

const FALLBACK_RATE = 0.92;

type FxQuote = Awaited<ReturnType<import("stripe").default["fxQuotes"]["create"]>>;

/** @public Effect-first API; see getUsdToEurRate for the promise facade. */
/** @public Effect-first API; see getUsdToEurRate for the promise facade. */
export const getUsdToEurRateEffect: Effect.Effect<number, never, StripeGateway> = Effect.gen(
  function* () {
    const stripe = yield* StripeGateway;
    const quote = (yield* stripe.use((client) =>
      client.fxQuotes.create({
        to_currency: "eur",
        from_currencies: ["usd"],
        lock_duration: "none",
      }),
    )) as FxQuote;

    const rate = quote.rates["usd"]?.rate_details?.base_rate;
    if (rate && rate > 0) return rate;
    return FALLBACK_RATE;
  },
).pipe(Effect.catch(() => Effect.succeed(FALLBACK_RATE)));

/** Promise-based facade for non-Effect call sites (server functions). */
export function getUsdToEurRate(): Promise<number> {
  return Effect.runPromise(
    getUsdToEurRateEffect.pipe(
      Effect.provide(StripeGateway.layer.pipe(Layer.provideMerge(Secrets.layer))),
    ),
  );
}
