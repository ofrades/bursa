import { and, asc, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { Db } from "../db";
import { screenRun, screenStock } from "../schema";
import { UNIVERSE } from "./universe";
import { fetchFxRates, fetchScreenData } from "./fetch";
import {
  DEFAULT_PARAMS,
  evaluateSymbol,
  finalize,
  type ScreenParams,
  type ScreenRow,
} from "./compute";
import { exclusionReasons, METHODOLOGY_VERSION } from "./report";

const BATCH_SIZE = 10;
const FETCH_CONCURRENCY = 4;

async function getRunningScreenRun(db: Db) {
  const [run] = await db
    .select()
    .from(screenRun)
    .where(eq(screenRun.status, "running"))
    .orderBy(desc(screenRun.runAt))
    .limit(1);
  return run ?? null;
}

async function startScreenRun(db: Db, params: ScreenParams = DEFAULT_PARAMS) {
  const existing = await getRunningScreenRun(db);
  if (existing) {
    if (Date.now() - existing.runAt.getTime() < 86400000) return existing;
    await db.update(screenRun).set({ status: "failed" }).where(eq(screenRun.id, existing.id));
  }

  const fxRates = await fetchFxRates();
  const id = crypto.randomUUID();
  const queue = UNIVERSE.map((entry) => ({
    runId: id,
    symbol: entry.symbol,
    name: entry.symbol,
    region: entry.region,
    country: entry.country,
  }));
  const inserts = [];
  for (let i = 0; i < queue.length; i += 10) {
    inserts.push(db.insert(screenStock).values(queue.slice(i, i + 10)));
  }
  try {
    await db.batch([
      db.insert(screenRun).values({
        id,
        params: JSON.stringify(params),
        fxRates: JSON.stringify(fxRates),
        universeCount: queue.length,
        methodologyVersion: METHODOLOGY_VERSION,
      }),
      ...inserts,
    ]);
  } catch (cause) {
    const active = await getRunningScreenRun(db);
    if (active) return active;
    throw cause;
  }
  const [run] = await db.select().from(screenRun).where(eq(screenRun.id, id)).limit(1);
  return run;
}

async function runScreenBatch(db: Db, runId: string, batchSize = BATCH_SIZE) {
  const [run] = await db.select().from(screenRun).where(eq(screenRun.id, runId)).limit(1);
  if (!run || run.status !== "running") return { processed: 0, remaining: 0 };

  const pending = await db
    .select()
    .from(screenStock)
    .where(and(eq(screenStock.runId, runId), eq(screenStock.processed, false)))
    .orderBy(asc(screenStock.createdAt))
    .limit(batchSize);

  const fxRates = JSON.parse(run.fxRates ?? "{}") as Record<string, number>;
  const params = JSON.parse(run.params) as ScreenParams;

  for (let i = 0; i < pending.length; i += FETCH_CONCURRENCY) {
    const chunk = pending.slice(i, i + FETCH_CONCURRENCY);
    await Promise.all(
      chunk.map(async (stock) => {
        let row: ScreenRow;
        try {
          const fetched = await fetchScreenData(stock.symbol, params);
          row = evaluateSymbol(
            {
              symbol: stock.symbol,
              name: fetched.name,
              region: stock.region,
              country: stock.country,
            },
            fetched.data,
            fxRates,
            params,
          );
          const issues = [...fetched.issues, ...exclusionReasons(row)];
          if (row.sue === null)
            issues.push(
              `Fewer than ${params.sueQuarters} usable earnings surprises; median used in ranking.`,
            );
          if (row.mom121 === null)
            issues.push("Adjusted-price momentum unavailable; median used in ranking.");
          await db
            .update(screenStock)
            .set({
              dataIssues: JSON.stringify(issues),
              inputSnapshot: JSON.stringify(fetched.snapshot),
            })
            .where(eq(screenStock.id, stock.id));
        } catch (cause) {
          await db
            .update(screenStock)
            .set({ processed: true, error: cause instanceof Error ? cause.message : "error" })
            .where(eq(screenStock.id, stock.id));
          return;
        }
        await db
          .update(screenStock)
          .set({
            name: row.name,
            sector: row.sector,
            currency: row.currency,
            mcapEur: row.mcapEur,
            advEur: row.advEur,
            analysts: row.analysts,
            fy1Rev: row.fy1Rev,
            fy2Rev: row.fy2Rev,
            revAvg: row.revAvg,
            breadth: row.breadth,
            sue: row.sue,
            roic: row.roic,
            ndEbitda: row.ndEbitda,
            fscore: row.fscore,
            mom121: row.mom121,
            fwdPe: row.fwdPe,
            epsGrowthFy1: row.epsGrowthFy1,
            roeFwd: row.roeFwd,
            fcfYield: row.fcfYield,
            fcfConversion: row.fcfConversion,
            upLast30d: row.upLast30d,
            downLast30d: row.downLast30d,
            passUniverse: row.passUniverse,
            passRevision: row.passRevision,
            passQuality: row.passQuality,
            passExpectations: row.passExpectations,
            processed: true,
          })
          .where(eq(screenStock.id, stock.id));
      }),
    );
  }

  const processed = await db
    .select({ id: screenStock.id })
    .from(screenStock)
    .where(and(eq(screenStock.runId, runId), eq(screenStock.processed, true)));
  await db
    .update(screenRun)
    .set({ processedCount: processed.length })
    .where(eq(screenRun.id, runId));
  const [remaining] = await db
    .select({ id: screenStock.id })
    .from(screenStock)
    .where(and(eq(screenStock.runId, runId), eq(screenStock.processed, false)))
    .limit(1);

  if (!remaining) await finalizeScreenRun(db, run, params);
  return { processed: pending.length };
}

async function finalizeScreenRun(db: Db, run: typeof screenRun.$inferSelect, params: ScreenParams) {
  const rows = await db
    .select()
    .from(screenStock)
    .where(eq(screenStock.runId, run.id))
    .orderBy(asc(screenStock.createdAt));

  const computed: ScreenRow[] = rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    region: r.region,
    country: r.country,
    sector: r.sector,
    currency: r.currency,
    mcapEur: r.mcapEur,
    advEur: r.advEur,
    analysts: r.analysts,
    fy1Rev: r.fy1Rev,
    fy2Rev: r.fy2Rev,
    revAvg: r.revAvg,
    breadth: r.breadth,
    sue: r.sue,
    roic: r.roic,
    ndEbitda: r.ndEbitda,
    fscore: r.fscore,
    mom121: r.mom121,
    fwdPe: r.fwdPe,
    epsGrowthFy1: r.epsGrowthFy1,
    roeFwd: r.roeFwd,
    fcfYield: r.fcfYield,
    fcfConversion: r.fcfConversion,
    upLast30d: r.upLast30d,
    downLast30d: r.downLast30d,
    passUniverse: r.passUniverse,
    passRevision: r.passRevision,
    passQuality: r.passQuality,
    passExpectations: r.passExpectations,
    composite: null,
    strict: false,
    weight: null,
    error: r.error,
  }));
  finalize(computed, params);

  const bySymbol = new Map(computed.map((r) => [r.symbol, r]));
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await Promise.all(
      chunk.map((r) => {
        const c = bySymbol.get(r.symbol);
        if (!c) return Promise.resolve();
        return db
          .update(screenStock)
          .set({ composite: c.composite, strict: c.strict, weight: c.weight })
          .where(eq(screenStock.id, r.id));
      }),
    );
  }

  await db
    .update(screenRun)
    .set({
      status: rows.every((r) => r.error !== null) ? "failed" : "done",
      processedCount: rows.length,
      passedUniverse: computed.filter((r) => r.passUniverse).length,
      passedRevision: computed.filter((r) => r.passUniverse && r.passRevision).length,
      survivorCount: computed.filter((r) => r.passUniverse && r.passRevision && r.passQuality)
        .length,
    })
    .where(eq(screenRun.id, run.id));
}

/** Starts a run if none is active, then processes one batch. Cheap enough to
 * call from an admin button or a cron trigger until the run completes. */
export async function advanceScreen(db: Db, runId?: string) {
  const [requested] = runId
    ? await db.select().from(screenRun).where(eq(screenRun.id, runId)).limit(1)
    : [];
  if (runId && !requested) throw new Error("Screen run not found");
  const run = requested ?? (await startScreenRun(db));
  const token = crypto.randomUUID();
  const [claimed] = await db
    .update(screenRun)
    .set({ lockToken: token, lockUntil: new Date(Date.now() + 15 * 60000) })
    .where(
      and(
        eq(screenRun.id, run.id),
        eq(screenRun.status, "running"),
        or(isNull(screenRun.lockUntil), lt(screenRun.lockUntil, new Date())),
      ),
    )
    .returning();
  let batchProcessed = 0;
  if (claimed) {
    try {
      batchProcessed = (await runScreenBatch(db, run.id)).processed;
    } finally {
      await db
        .update(screenRun)
        .set({ lockToken: null, lockUntil: null })
        .where(and(eq(screenRun.id, run.id), eq(screenRun.lockToken, token)));
    }
  }
  const [fresh] = await db.select().from(screenRun).where(eq(screenRun.id, run.id)).limit(1);
  return {
    runId: run.id,
    status: fresh?.status ?? "running",
    processed: fresh?.processedCount ?? 0,
    universe: fresh?.universeCount ?? 0,
    batchProcessed,
  };
}
