import { Context, Effect, Layer } from "effect";
import { ExternalServiceError, NotConfiguredError } from "../errors";
import { Secrets } from "./secrets";

type StripeClient = import("stripe").default;

const makeClient = async (key: string): Promise<StripeClient> => {
  const { default: Stripe } = await import("stripe");
  return new Stripe(key, { apiVersion: "2026-04-22.preview" });
};

export class StripeGateway extends Context.Service<
  StripeGateway,
  {
    /** Authenticated client; fails if Stripe is unreachable or not configured. */
    readonly use: <A>(
      f: (client: StripeClient) => Promise<A>,
    ) => Effect.Effect<A, ExternalServiceError | NotConfiguredError>;
  }
>()("@app/StripeGateway") {
  static readonly layer = Layer.effect(
    StripeGateway,
    Effect.gen(function* () {
      const secrets = yield* Secrets;

      const use = Effect.fn("StripeGateway.use")(function* <A>(
        f: (client: StripeClient) => Promise<A>,
      ) {
        const key = yield* secrets.getOrThrow("STRIPE_SECRET_KEY");
        const client = yield* Effect.tryPromise({
          try: () => makeClient(key),
          catch: (cause) => new ExternalServiceError({ service: "stripe", cause }),
        });
        return yield* Effect.tryPromise({
          try: () => f(client),
          catch: (cause) => new ExternalServiceError({ service: "stripe", cause }),
        });
      });

      return { use };
    }),
  );
}
