import { eq, sql } from "drizzle-orm";
import { user, walletTopUp } from "./schema";
import type { Db } from "./db";

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

// Statement order matters: the top-up insert is the duplicate gate (UNIQUE
// index on stripe_checkout_session_id), so a retried webhook credits nothing.
// D1 has no interactive transactions; the insert→increment window relies on
// webhook retries for convergence, same guarantee the old flow effectively had.
export async function applyWalletTopUp(
  db: Db,
  input: {
    userId: string;
    checkoutSessionId: string;
    stripeEventId?: string | null;
    centsToAdd: number;
  },
) {
  if (input.centsToAdd <= 0) {
    return { status: "ignored" as const, centsAdded: 0 };
  }

  const accounts = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);

  if (!accounts[0]) {
    throw new Error("User not found");
  }

  try {
    await db.insert(walletTopUp).values({
      userId: input.userId,
      stripeCheckoutSessionId: input.checkoutSessionId,
      stripeEventId: input.stripeEventId ?? null,
      amountCents: input.centsToAdd,
    });
  } catch (error) {
    if (error instanceof Error && isDuplicateCheckoutSessionError(error)) {
      return { status: "duplicate" as const, centsAdded: 0 };
    }
    throw error;
  }

  await db
    .update(user)
    .set({ walletBalance: sql`${user.walletBalance} + ${input.centsToAdd}` })
    .where(eq(user.id, input.userId));

  return { status: "applied" as const, centsAdded: input.centsToAdd };
}
