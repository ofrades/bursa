import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./db";
import { user } from "./schema";

const DEFAULT_ANALYSIS_MAX_CHARGE_CENTS = 25;
const COOLDOWN_SECONDS = 10;
const STALE_SECONDS = 10 * 60;

export type ReservationFailure = "not-found" | "busy" | "rate-limited" | "insufficient-funds";

export function getAnalysisMaxChargeCents(): number {
  const configured = Number(process.env.ANALYSIS_MAX_CHARGE_CENTS);
  return Number.isInteger(configured) && configured > 0 && configured <= 10_000
    ? configured
    : DEFAULT_ANALYSIS_MAX_CHARGE_CENTS;
}

export function capAnalysisCharge(calculatedCents: number, reservedCents: number): number {
  return Math.min(Math.max(0, Math.ceil(calculatedCents)), Math.max(0, reservedCents));
}

export function completedAnalysisCharge(
  calculatedCents: number | null,
  reservedCents: number,
): number {
  return calculatedCents === null
    ? Math.max(0, reservedCents)
    : capAnalysisCharge(calculatedCents, reservedCents);
}

export const analysisUsageInsertSql = `
  INSERT INTO usage_log (
    id, reservation_id, user_id, symbol, model, prompt_tokens, completion_tokens,
    total_tokens, provider_cost_usd, cost_cents, usage_reported, created_at
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, min(?, analysis_reserved_cents), ?, ?
  FROM user
  WHERE id = ? AND active_analysis_id = ?
    AND NOT EXISTS (SELECT 1 FROM usage_log WHERE reservation_id = ?)
`;

export const analysisReservationDebitSql = `
  UPDATE user
  SET wallet_balance = wallet_balance + analysis_reserved_cents
        - (SELECT cost_cents FROM usage_log WHERE reservation_id = ?),
      active_analysis_id = NULL,
      analysis_reserved_cents = 0,
      analysis_started_at = NULL
  WHERE id = ? AND active_analysis_id = ?
    AND EXISTS (SELECT 1 FROM usage_log WHERE reservation_id = ?)
`;

export async function reserveAnalysis(
  db: Db,
  userId: string,
): Promise<{ id: string; isAdmin: boolean } | { failure: ReservationFailure }> {
  const id = crypto.randomUUID();
  const maxChargeCents = getAnalysisMaxChargeCents();
  const now = Math.floor(Date.now() / 1000);
  const staleBefore = now - STALE_SECONDS;
  const cooldownBefore = now - COOLDOWN_SECONDS;
  const rows = await db.all<{ role: string }>(sql`
    UPDATE "user"
    SET
      wallet_balance = wallet_balance
        + CASE WHEN active_analysis_id IS NOT NULL AND analysis_started_at <= ${staleBefore}
            THEN analysis_reserved_cents ELSE 0 END
        - CASE WHEN role = 'admin' THEN 0 ELSE ${maxChargeCents} END,
      active_analysis_id = ${id},
      analysis_reserved_cents = CASE WHEN role = 'admin' THEN 0 ELSE ${maxChargeCents} END,
      analysis_started_at = ${now},
      last_analysis_at = ${now}
    WHERE id = ${userId}
      AND (active_analysis_id IS NULL OR analysis_started_at <= ${staleBefore})
      AND (last_analysis_at IS NULL OR last_analysis_at <= ${cooldownBefore})
      AND (role = 'admin' OR wallet_balance
        + CASE WHEN active_analysis_id IS NOT NULL AND analysis_started_at <= ${staleBefore}
            THEN analysis_reserved_cents ELSE 0 END >= ${maxChargeCents})
    RETURNING role
  `);
  if (rows[0]) return { id, isAdmin: rows[0].role === "admin" };

  const [row] = await db
    .select({
      walletBalance: user.walletBalance,
      activeAnalysisId: user.activeAnalysisId,
      analysisStartedAt: user.analysisStartedAt,
      lastAnalysisAt: user.lastAnalysisAt,
      role: user.role,
    })
    .from(user)
    .where(eq(user.id, userId));
  if (!row) return { failure: "not-found" };
  if (row.activeAnalysisId && (row.analysisStartedAt?.getTime() ?? 0) > staleBefore * 1000)
    return { failure: "busy" };
  if ((row.lastAnalysisAt?.getTime() ?? 0) > cooldownBefore * 1000)
    return { failure: "rate-limited" };
  if (row.role !== "admin" && row.walletBalance < maxChargeCents)
    return { failure: "insufficient-funds" };
  return { failure: "busy" };
}

export async function releaseAnalysis(db: Db, userId: string, reservationId: string) {
  await db
    .update(user)
    .set({
      walletBalance: sql`${user.walletBalance} + ${user.analysisReservedCents}`,
      activeAnalysisId: null,
      analysisReservedCents: 0,
      analysisStartedAt: null,
    })
    .where(and(eq(user.id, userId), eq(user.activeAnalysisId, reservationId)));
}

export type AnalysisUsageSettlement = {
  userId: string;
  reservationId: string;
  symbol: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  providerCostUsd: number | null;
  calculatedCents: number;
  usageReported: boolean;
};

export async function settleAnalysisUsage(
  d1: D1Database,
  input: AnalysisUsageSettlement,
): Promise<{ chargedCents: number; idempotent: boolean }> {
  const requestedChargeCents = capAnalysisCharge(
    input.calculatedCents,
    getAnalysisMaxChargeCents(),
  );
  const usageId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const insert = d1
    .prepare(analysisUsageInsertSql)
    .bind(
      usageId,
      input.reservationId,
      input.userId,
      input.symbol,
      input.model,
      input.promptTokens,
      input.completionTokens,
      input.totalTokens,
      input.providerCostUsd,
      requestedChargeCents,
      input.usageReported ? 1 : 0,
      now,
      input.userId,
      input.reservationId,
      input.reservationId,
    );
  const debit = d1
    .prepare(analysisReservationDebitSql)
    .bind(input.reservationId, input.userId, input.reservationId, input.reservationId);

  const [insertResult, debitResult] = await d1.batch([insert, debit]);
  if ((insertResult.meta.changes ?? 0) === 1 && (debitResult.meta.changes ?? 0) !== 1) {
    throw new Error("Atomic analysis settlement did not debit its reservation");
  }
  const existing = await d1
    .prepare("SELECT cost_cents FROM usage_log WHERE reservation_id = ?")
    .bind(input.reservationId)
    .first<{ cost_cents: number }>();
  if (existing) {
    return {
      chargedCents: existing.cost_cents,
      idempotent: (insertResult.meta.changes ?? 0) !== 1,
    };
  }
  throw new Error("Analysis reservation is no longer active");
}
