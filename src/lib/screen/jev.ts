// Advisory revision judgments; deterministic screen gates remain unchanged.
import { Effect } from "effect";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db";
import { getSecret } from "../../secrets";
import { screenRun, screenStock } from "../schema";
import { Secrets } from "../effect/services/secrets";
import { evaluateChoices, gatherNewsEvidence, revisionQuestion } from "../../server/jev";

const CONCURRENCY = 3;
type RevisionVerdict = {
  classification: string;
  probability: number;
  rationale: string;
};

async function classifyOne(row: ScreenVerdictRow): Promise<RevisionVerdict> {
  const evidence = await gatherNewsEvidence(row.symbol);
  const { result } = await Effect.runPromise(
    evaluateChoices(
      {
        company: { symbol: row.symbol, name: row.name },
        metrics: {
          fy1Revision90d: row.fy1Rev,
          fy2Revision90d: row.fy2Rev,
          analystUp30d: row.upLast30d,
          analystDown30d: row.downLast30d,
        },
        evidence,
      },
      { revisionQuality: revisionQuestion },
    ).pipe(Effect.provide(Secrets.layer)),
  );
  const answer = result.revisionQuality;
  return {
    classification: answer.value,
    probability: answer.probability,
    rationale:
      answer.value === "INSUFFICIENT_EVIDENCE"
        ? "Supplied evidence does not identify a revision driver."
        : `Advisory classification from supplied headlines: ${evidence.map((item) => item.title).join("; ")}`,
  };
}

type ScreenVerdictRow = {
  id: string;
  symbol: string;
  name: string;
  region: string | null;
  sector: string | null;
  revAvg: number | null;
  fy1Rev: number | null;
  fy2Rev: number | null;
  sue: number | null;
  upLast30d: number | null;
  downLast30d: number | null;
  mom121: number | null;
};

/** Classifies the strict quintile of the latest done run. Advisory output only. */
export async function classifyLatestRun(
  db: Db,
  options: { all?: boolean } = {},
): Promise<{ classified: number; failed: number; skipped?: string }> {
  const apiKey = await getSecret("OPENROUTER_API_KEY");
  if (!apiKey) return { classified: 0, failed: 0, skipped: "OPENROUTER_API_KEY not configured" };

  const [run] = await db
    .select()
    .from(screenRun)
    .where(eq(screenRun.status, "done"))
    .orderBy(desc(screenRun.runAt))
    .limit(1);
  if (!run) return { classified: 0, failed: 0, skipped: "no completed screen run" };

  const rows = options.all
    ? await db
        .select()
        .from(screenStock)
        .where(
          and(
            eq(screenStock.runId, run.id),
            eq(screenStock.passUniverse, true),
            eq(screenStock.passRevision, true),
            eq(screenStock.passQuality, true),
          ),
        )
    : await db
        .select()
        .from(screenStock)
        .where(and(eq(screenStock.runId, run.id), eq(screenStock.strict, true)));

  let classified = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (row): Promise<RevisionVerdict | null> => {
        try {
          return await classifyOne(row);
        } catch {
          return null;
        }
      }),
    );
    await Promise.all(
      chunk.map((row, j) => {
        const verdict = results[j];
        if (!verdict) {
          failed += 1;
          return Promise.resolve();
        }
        classified += 1;
        return db
          .update(screenStock)
          .set({
            jevVerdict: verdict.classification,
            jevProbability: verdict.probability,
            jevRationale: verdict.rationale,
          })
          .where(eq(screenStock.id, row.id));
      }),
    );
  }
  return { classified, failed };
}
