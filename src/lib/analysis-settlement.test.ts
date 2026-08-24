import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { analysisReservationDebitSql, analysisUsageInsertSql } from "./analysis-reservation";

describe("analysis usage settlement SQL", () => {
  it("atomically debits once and makes a repeated settlement idempotent", () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.exec(`
        CREATE TABLE user (
          id text PRIMARY KEY,
          wallet_balance integer NOT NULL,
          active_analysis_id text,
          analysis_reserved_cents integer NOT NULL,
          analysis_started_at integer
        );
        CREATE TABLE usage_log (
          id text PRIMARY KEY,
          reservation_id text NOT NULL UNIQUE,
          user_id text NOT NULL,
          symbol text NOT NULL,
          model text NOT NULL,
          prompt_tokens integer,
          completion_tokens integer,
          total_tokens integer,
          provider_cost_usd real,
          cost_cents integer NOT NULL,
          usage_reported integer NOT NULL,
          created_at integer NOT NULL
        );
        INSERT INTO user VALUES ('u1', 75, 'reservation-1', 25, 1);
      `);

      const settle = sqlite.transaction(() => {
        sqlite
          .prepare(analysisUsageInsertSql)
          .run(
            crypto.randomUUID(),
            "reservation-1",
            "u1",
            "TEST",
            "model",
            10,
            5,
            15,
            0.01,
            10,
            1,
            1,
            "u1",
            "reservation-1",
            "reservation-1",
          );
        sqlite
          .prepare(analysisReservationDebitSql)
          .run("reservation-1", "u1", "reservation-1", "reservation-1");
      });

      settle();
      settle();

      expect(sqlite.prepare("SELECT wallet_balance FROM user WHERE id = 'u1'").get()).toEqual({
        wallet_balance: 90,
      });
      expect(sqlite.prepare("SELECT count(*) AS count FROM usage_log").get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });
});
