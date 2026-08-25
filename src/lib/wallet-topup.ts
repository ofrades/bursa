import { Effect } from "effect";
import { eq, sql } from "drizzle-orm";
import { user, walletTopUp } from "./schema";
import type { Db } from "./db";
import { ExternalServiceError, NotFoundError } from "./effect/errors";

function isDuplicateCheckoutSessionError(error: Error) {
  // drizzle v1 wraps driver errors in DrizzleQueryError; the SQLite message
  // lives on .cause, so walk the chain.
  const messages: string[] = [];
  let current: Error | undefined = error;
  while (current) {
    messages.push(current.message);
    current = current.cause instanceof Error ? current.cause : undefined;
  }
  return messages.some((message) =>
    /UNIQUE constraint failed: wallet_top_up\.stripe_checkout_session_id/.test(message),
  );
}

export type TopUpInput = {
  userId: string;
  checkoutSessionId: string;
  stripeEventId?: string | null;
  centsToAdd: number;
};

export type TopUpResult = { status: "ignored" | "duplicate" | "applied"; centsAdded: number };

// Statement order matters: the top-up insert is the duplicate gate (UNIQUE
// index on stripe_checkout_session_id), so a retried webhook credits nothing.
// D1 has no interactive transactions; the insert→increment window relies on
// webhook retries for convergence, same guarantee the old flow effectively had.
/** @public Effect-first API; see applyWalletTopUp for the promise facade. */
/** @public Effect-first API; see applyWalletTopUp for the promise facade. */
export const applyWalletTopUpEffect = (
  db: Db,
  input: TopUpInput,
): Effect.Effect<TopUpResult, NotFoundError | ExternalServiceError> =>
  Effect.gen(function* () {
    if (input.centsToAdd <= 0) {
      return { status: "ignored" as const, centsAdded: 0 };
    }

    const accounts = yield* Effect.tryPromise({
      try: () => db.select({ id: user.id }).from(user).where(eq(user.id, input.userId)).limit(1),
      catch: (cause) => new ExternalServiceError({ service: "d1", cause }),
    });

    if (!accounts[0]) {
      return yield* new NotFoundError({ resource: `user ${input.userId}` });
    }

    const inserted = yield* Effect.tryPromise({
      try: () =>
        db.insert(walletTopUp).values({
          userId: input.userId,
          stripeCheckoutSessionId: input.checkoutSessionId,
          stripeEventId: input.stripeEventId ?? null,
          amountCents: input.centsToAdd,
        }),
      catch: (cause) => ({ cause, error: cause instanceof Error ? cause : undefined }),
    }).pipe(
      Effect.catch((wrapped) => {
        if (wrapped.error && isDuplicateCheckoutSessionError(wrapped.error)) {
          return Effect.succeed({ status: "duplicate" as const, centsAdded: 0 });
        }
        return Effect.fail(new ExternalServiceError({ service: "d1", cause: wrapped.cause }));
      }),
    );

    if ("status" in inserted) return inserted;

    yield* Effect.tryPromise({
      try: () =>
        db
          .update(user)
          .set({ walletBalance: sql`${user.walletBalance} + ${input.centsToAdd}` })
          .where(eq(user.id, input.userId)),
      catch: (cause) => new ExternalServiceError({ service: "d1", cause }),
    });

    return { status: "applied" as const, centsAdded: input.centsToAdd };
  });

/** Promise-based facade for non-Effect call sites. */
export async function applyWalletTopUp(db: Db, input: TopUpInput) {
  return Effect.runPromise(
    applyWalletTopUpEffect(db, input).pipe(
      Effect.catchTags({
        NotFoundError: Effect.fail,
        ExternalServiceError: Effect.fail,
      }),
    ),
  );
}
