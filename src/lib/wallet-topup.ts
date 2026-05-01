import { eq } from "drizzle-orm";
import { user, walletTopUp } from "./schema";

type Db = Awaited<ReturnType<(typeof import("./db"))["getDb"]>>;
type WalletTopUpDb = Pick<Db, "transaction">;

function isDuplicateCheckoutSessionError(error: unknown) {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: wallet_top_up\.stripe_checkout_session_id/.test(error.message)
  );
}

export async function applyWalletTopUp(
  db: WalletTopUpDb,
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

  return db.transaction((tx) => {
    const account = tx
      .select({ walletBalance: user.walletBalance })
      .from(user)
      .where(eq(user.id, input.userId))
      .get();

    if (!account) {
      throw new Error("User not found");
    }

    try {
      tx.insert(walletTopUp)
        .values({
          userId: input.userId,
          stripeCheckoutSessionId: input.checkoutSessionId,
          stripeEventId: input.stripeEventId ?? null,
          amountCents: input.centsToAdd,
        })
        .run();
    } catch (error) {
      if (isDuplicateCheckoutSessionError(error)) {
        return { status: "duplicate" as const, centsAdded: 0 };
      }
      throw error;
    }

    tx.update(user)
      .set({ walletBalance: (account.walletBalance ?? 0) + input.centsToAdd })
      .where(eq(user.id, input.userId))
      .run();

    return { status: "applied" as const, centsAdded: input.centsToAdd };
  });
}
