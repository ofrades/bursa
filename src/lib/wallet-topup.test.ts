import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vite-plus/test";
import { user, walletTopUp } from "./schema";
import { applyWalletTopUp } from "./wallet-topup";

function createTestDb() {
  const sqlite = new Database(":memory:");

  sqlite.exec(`
    CREATE TABLE user (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      image text,
      analysis_credits integer NOT NULL DEFAULT 0,
      wallet_balance integer NOT NULL DEFAULT 0,
      stripe_customer_id text,
      stripe_subscription_id text,
      stripe_price_id text,
      subscription_status text,
      created_at integer NOT NULL
    );

    CREATE TABLE wallet_top_up (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      stripe_checkout_session_id text NOT NULL,
      stripe_event_id text,
      amount_cents integer NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE cascade
    );

    CREATE UNIQUE INDEX uq_wallet_top_up_checkout_session
      ON wallet_top_up (stripe_checkout_session_id);
    CREATE INDEX idx_wallet_top_up_user ON wallet_top_up (user_id);
  `);

  return {
    sqlite,
    db: drizzle(sqlite, { schema: { user, walletTopUp } }),
  };
}

describe("applyWalletTopUp", () => {
  it("credits a checkout session only once even if Stripe retries the webhook", async () => {
    const { sqlite, db } = createTestDb();

    try {
      await db.insert(user).values({
        id: "user-1",
        name: "Carol",
        email: "carol@example.com",
        walletBalance: 79,
        createdAt: new Date(0),
      });

      await expect(
        applyWalletTopUp(db, {
          userId: "user-1",
          checkoutSessionId: "cs_test_123",
          stripeEventId: "evt_1",
          centsToAdd: 100,
        }),
      ).resolves.toMatchObject({ status: "applied", centsAdded: 100 });

      await expect(
        applyWalletTopUp(db, {
          userId: "user-1",
          checkoutSessionId: "cs_test_123",
          stripeEventId: "evt_retry",
          centsToAdd: 100,
        }),
      ).resolves.toMatchObject({ status: "duplicate", centsAdded: 0 });

      const [account] = await db
        .select({ walletBalance: user.walletBalance })
        .from(user)
        .where(eq(user.id, "user-1"));
      const topUps = await db.select().from(walletTopUp);

      expect(account?.walletBalance).toBe(179);
      expect(topUps).toHaveLength(1);
      expect(topUps[0]).toMatchObject({
        userId: "user-1",
        stripeCheckoutSessionId: "cs_test_123",
        amountCents: 100,
      });
    } finally {
      sqlite.close();
    }
  });

  it("fails cleanly when the user does not exist", async () => {
    const { sqlite, db } = createTestDb();

    try {
      await expect(
        applyWalletTopUp(db, {
          userId: "missing-user",
          checkoutSessionId: "cs_missing",
          stripeEventId: "evt_missing",
          centsToAdd: 100,
        }),
      ).rejects.toThrow("User not found");

      const topUps = await db.select().from(walletTopUp);
      expect(topUps).toHaveLength(0);
    } finally {
      sqlite.close();
    }
  });
});
