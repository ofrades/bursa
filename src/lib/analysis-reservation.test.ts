import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import type { Db } from "./db";
import {
  capAnalysisCharge,
  completedAnalysisCharge,
  getAnalysisMaxChargeCents,
  releaseAnalysis,
  reserveAnalysis,
} from "./analysis-reservation";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE user (
      id text PRIMARY KEY NOT NULL,
      role text NOT NULL DEFAULT 'user',
      wallet_balance integer NOT NULL DEFAULT 0,
      active_analysis_id text,
      analysis_reserved_cents integer NOT NULL DEFAULT 0,
      analysis_started_at integer,
      last_analysis_at integer
    );
    INSERT INTO user (id, wallet_balance) VALUES ('u1', 100);
  `);
  const raw: unknown = drizzle({ client: sqlite });
  return { sqlite, db: raw as Db };
}

describe("analysis reservations", () => {
  it("atomically permits only one active analysis and refunds an abandoned hold", async () => {
    const { sqlite, db } = createTestDb();
    try {
      const [first, second] = await Promise.all([
        reserveAnalysis(db, "u1"),
        reserveAnalysis(db, "u1"),
      ]);
      const accepted = [first, second].find((result) => "id" in result);
      const rejected = [first, second].find((result) => "failure" in result);

      expect(accepted).toBeDefined();
      expect(rejected).toEqual({ failure: "busy" });
      expect(sqlite.prepare("SELECT wallet_balance FROM user WHERE id = 'u1'").get()).toEqual({
        wallet_balance: 100 - getAnalysisMaxChargeCents(),
      });

      if (accepted && "id" in accepted) await releaseAnalysis(db, "u1", accepted.id);
      expect(sqlite.prepare("SELECT wallet_balance FROM user WHERE id = 'u1'").get()).toEqual({
        wallet_balance: 100,
      });
    } finally {
      sqlite.close();
    }
  });

  it("rejects an account that cannot fund the reservation", async () => {
    const { sqlite, db } = createTestDb();
    try {
      sqlite.prepare("UPDATE user SET wallet_balance = 0 WHERE id = 'u1'").run();
      await expect(reserveAnalysis(db, "u1")).resolves.toEqual({ failure: "insufficient-funds" });
    } finally {
      sqlite.close();
    }
  });

  it("caps a provider overage at the reservation so balance cannot go negative", () => {
    expect(capAnalysisCharge(40, 25)).toBe(25);
    expect(capAnalysisCharge(4.2, 25)).toBe(5);
    expect(capAnalysisCharge(-1, 25)).toBe(0);
  });

  it("charges the full hold when a completed stream has no provider usage event", () => {
    expect(completedAnalysisCharge(null, 25)).toBe(25);
    expect(completedAnalysisCharge(4, 25)).toBe(4);
  });
});
