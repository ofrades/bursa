import { Effect } from "effect";
import { z } from "zod";
import { authenticatedUserEffect } from "../lib/auth";
import { Database } from "../lib/effect/services/database";
import { ExternalServiceError, ValidationError } from "../lib/effect/errors";
import { reserveAnalysis, releaseAnalysis } from "../lib/analysis-reservation";
import { businessJudgmentsSchema } from "../lib/judgments";
import { evaluateChoices, gatherNewsEvidence, momentumQuestion, revisionQuestion } from "./jev";
import { gatherAnalysisSnapshot, saveAnalysisDecision, chargeUserForUsage } from "./recommend";

const requestSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z0-9.^=-]+$/)
    .transform((value) => value.toUpperCase()),
});
const reservationErrors = {
  "not-found": [401, "Unauthorized"],
  busy: [409, "Analysis already in progress"],
  "rate-limited": [429, "Please wait before analyzing again"],
  "insufficient-funds": [402, "Insufficient wallet balance"],
} as const;

const analysisTask = <A>(task: () => Promise<A>) =>
  Effect.tryPromise({
    try: task,
    catch: (cause) => new ExternalServiceError({ service: "analysis", cause }),
  });

export const analyzeProgram = Effect.fn("analysis.run")(function* (request: Request) {
  const session = yield* authenticatedUserEffect(request);
  const body = yield* Effect.tryPromise({
    try: () => request.json(),
    catch: () => new ValidationError({ message: "Invalid JSON" }),
  });
  const input = requestSchema.safeParse(body);
  if (!input.success) return yield* new ValidationError({ message: "Invalid symbol" });
  const { symbol } = input.data;
  const { db } = yield* Database;
  const reservation = yield* analysisTask(() => reserveAnalysis(db, session.sub));
  if ("failure" in reservation) {
    const [status, error] = reservationErrors[reservation.failure];
    return Response.json({ error }, { status });
  }
  return yield* Effect.gen(function* () {
    const [snapshot, evidence] = yield* analysisTask(() =>
      Promise.all([gatherAnalysisSnapshot(symbol), gatherNewsEvidence(symbol)]),
    );
    const { stockData } = snapshot;
    const { result, usage } = yield* evaluateChoices(
      {
        company: { symbol, name: stockData.companyName, business: stockData.businessSummary },
        metrics: {
          epsRevision90dPct: stockData.earningsEstimateDelta90dPct,
          revenueGrowth: stockData.revenueGrowth,
          earningsGrowth: stockData.earningsGrowth,
        },
        evidence,
      },
      { revisionQuality: revisionQuestion, businessMomentum: momentumQuestion },
    );
    const judgments = businessJudgmentsSchema.parse({
      model: result.meta.model,
      revisionQuality: result.revisionQuality,
      businessMomentum: result.businessMomentum,
      evidence,
    });
    const analysisId = yield* analysisTask(() =>
      saveAnalysisDecision({
        db,
        symbol,
        snapshot,
        judgments,
        userId: session.sub,
        analysisDate: new Date().toISOString().slice(0, 10),
      }),
    );
    const billing = reservation.isAdmin
      ? null
      : yield* analysisTask(() => chargeUserForUsage(session.sub, reservation.id, symbol, usage));
    return Response.json({ analysisId, billing }, { headers: { "Cache-Control": "no-store" } });
  }).pipe(Effect.ensuring(Effect.promise(() => releaseAnalysis(db, session.sub, reservation.id))));
});
