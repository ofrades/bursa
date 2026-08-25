import { Context, Effect, Layer } from "effect";
import { NotConfiguredError } from "../errors";
import { getSecret, type SecretName } from "../../../secrets";

export class Secrets extends Context.Service<
  Secrets,
  {
    readonly get: (name: SecretName) => Effect.Effect<string | undefined>;
    readonly getOrThrow: (name: SecretName) => Effect.Effect<string, NotConfiguredError>;
  }
>()("@app/Secrets") {
  static readonly layer = Layer.effect(
    Secrets,
    Effect.gen(function* () {
      const get = (name: SecretName): Effect.Effect<string | undefined> =>
        Effect.promise(() => getSecret(name));

      const getOrThrow = (name: SecretName) =>
        Effect.gen(function* () {
          const value = yield* get(name);
          if (!value) {
            return yield* new NotConfiguredError({ setting: name });
          }
          return value;
        });

      return { get, getOrThrow };
    }),
  );
}
