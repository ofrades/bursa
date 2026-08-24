import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "Bursa",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    const prod = stage === "prod";
    const database = yield* Cloudflare.D1.Database("Database", {
      migrations: "./drizzle",
    }).pipe(Alchemy.RemovalPolicy.retain(prod));

    // Cloudflare permits one account-level store. Prefix physical names so
    // similarly named credentials from other applications cannot collide.
    const store = yield* Cloudflare.SecretsStore.Store("AppSecrets");
    const appSecret = (id: string, envName: string) =>
      Effect.gen(function* () {
        const value = yield* Config.redacted(envName);
        return yield* Cloudflare.SecretsStore.Secret(id, {
          store,
          name: `BURSA_${envName}`,
          value,
        }).pipe(Alchemy.RemovalPolicy.retain(prod));
      });
    const authSecret = yield* appSecret("AuthSecret", "AUTH_SECRET");
    const googleClientSecret = yield* appSecret("GoogleClientSecret", "GOOGLE_CLIENT_SECRET");
    const openrouterApiKey = yield* appSecret("OpenrouterApiKey", "OPENROUTER_API_KEY");
    const fmpApiKey = yield* appSecret("FmpApiKey", "FMP_API_KEY");
    const stripeSecretKey = yield* appSecret("StripeSecretKey", "STRIPE_SECRET_KEY");
    const stripeWebhookSecret = yield* appSecret("StripeWebhookSecret", "STRIPE_WEBHOOK_SECRET");

    const website = yield* Cloudflare.Website.Vite("Website", {
      routes: prod ? [{ pattern: "bursa.mohshoo.com/*" }] : [],
      env: {
        DB: database,
        BETTER_AUTH_URL: prod ? "https://bursa.mohshoo.com" : Config.string("BETTER_AUTH_URL"),
        AUTH_SECRET: authSecret,
        GOOGLE_CLIENT_ID: Config.string("GOOGLE_CLIENT_ID"),
        GOOGLE_CLIENT_SECRET: googleClientSecret,
        OPENROUTER_API_KEY: openrouterApiKey,
        FMP_API_KEY: fmpApiKey,
        MARKET_DATA_PROVIDER: Config.string("MARKET_DATA_PROVIDER").pipe(Config.withDefault("")),
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PRICE_CREDITS_10: Config.string("STRIPE_PRICE_CREDITS_10").pipe(
          Config.withDefault(""),
        ),
        BILLING_MARKUP_MULTIPLIER: Config.string("BILLING_MARKUP_MULTIPLIER").pipe(
          Config.withDefault("1.8"),
        ),
        AI_TIMEOUT_MS: Config.string("AI_TIMEOUT_MS").pipe(Config.withDefault("300000")),
        ANALYSIS_MAX_CHARGE_CENTS: Config.string("ANALYSIS_MAX_CHARGE_CENTS").pipe(
          Config.withDefault("25"),
        ),
      },
    }).pipe(Alchemy.RemovalPolicy.retain(prod));

    return {
      databaseName: database.databaseName,
      url: website.url,
    };
  }).pipe(Effect.orDie),
);
