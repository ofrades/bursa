import { Context, Effect, Layer } from "effect";
import { ExternalServiceError } from "../errors";
import type { Db } from "../../db";
import { getDb } from "../../db";

export class Database extends Context.Service<
  Database,
  {
    /** Drizzle client over the D1 binding (memoized per isolate). */
    readonly db: Db;
  }
>()("@app/Database") {
  static readonly layer = Layer.sync(Database, () => ({ db: getDb() }));
}

/** Run a drizzle query, mapping driver failures to a typed error. */
export function query<A>(
  run: (db: Db) => Promise<A>,
): Effect.Effect<A, ExternalServiceError, Database> {
  return Effect.gen(function* () {
    const { db } = yield* Database;
    return yield* Effect.tryPromise({
      try: () => run(db),
      catch: (cause) => new ExternalServiceError({ service: "d1", cause }),
    });
  });
}
