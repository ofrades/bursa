// Forward-return outcome tracking for completed screen runs. Each run's
// survivors are the picks; every call records returns for every horizon whose
// window has fully elapsed since the run date, upserting over earlier values.
// Win/loss is judged on excess vs the STOXX 600 (market) — the cohort's
// equal-weight mean is reported alongside for context.
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import { screenOutcome, screenRun, screenStock } from "../schema";
import { isSurvivor, METHODOLOGY_VERSION } from "./report";

const HORIZON_SESSIONS = [21, 63, 126, 252] as const;
const BENCHMARK_SYMBOL = "^STOXX";

export type PriceBar = { date: Date; adjClose?: number | null };

export type HorizonReturn = {
  priceAtRun: number;
  priceAtEnd: number;
  returnPct: number;
};

/** Entry = last adjusted close on or before the run date; exit = the bar
 * `horizon` trading sessions later. Null until the window has fully elapsed. */
export function horizonReturn(
  bars: readonly PriceBar[],
  runAt: Date,
  horizon: number,
): HorizonReturn | null {
  const sorted = bars
    .filter((b) => isNum(b.adjClose) && b.adjClose > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const runDay = Date.UTC(runAt.getUTCFullYear(), runAt.getUTCMonth(), runAt.getUTCDate());
  let entryIndex = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].date.getTime() <= runDay) entryIndex = i;
    else break;
  }
  if (entryIndex < 0) return null;
  const endIndex = entryIndex + horizon;
  if (endIndex >= sorted.length) return null;
  const priceAtRun = sorted[entryIndex].adjClose!;
  const priceAtEnd = sorted[endIndex].adjClose!;
  return { priceAtRun, priceAtEnd, returnPct: priceAtEnd / priceAtRun - 1 };
}

function isNum(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v);
}

const chartPrices = z
  .object({
    chart: z.object({
      result: z
        .array(
          z.object({
            timestamp: z.array(z.number()),
            indicators: z.object({
              adjclose: z.array(z.object({ adjclose: z.array(z.number().nullable()) })).min(1),
            }),
          }),
        )
        .min(1),
    }),
  })
  .strip();

async function fetchBars(symbol: string, from: Date, to: Date): Promise<PriceBar[]> {
  try {
    const search = new URLSearchParams({
      period1: String(Math.floor(from.getTime() / 1000)),
      period2: String(Math.floor(to.getTime() / 1000)),
      interval: "1d",
    });
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${search.toString()}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30000) },
    );
    if (!res.ok) return [];
    const parsed = chartPrices.safeParse(await res.json());
    if (!parsed.success) return [];
    const { timestamp, indicators } = parsed.data.chart.result[0];
    const adj = indicators.adjclose[0].adjclose;
    return timestamp
      .map((ts, i) => ({ date: new Date(ts * 1000), adjClose: adj[i] ?? null }))
      .filter((b): b is PriceBar & { adjClose: number } => isNum(b.adjClose));
  } catch {
    return [];
  }
}

/** Records outcomes for a done run (default: the latest by methodology). */
export async function recordOutcomes(db: Db, runId?: string) {
  const runs = runId
    ? await db.select().from(screenRun).where(eq(screenRun.id, runId)).limit(1)
    : await db
        .select()
        .from(screenRun)
        .where(
          and(eq(screenRun.status, "done"), eq(screenRun.methodologyVersion, METHODOLOGY_VERSION)),
        )
        .orderBy(desc(screenRun.runAt))
        .limit(1);
  const run = runs[0];
  if (!run || run.status !== "done") {
    return { runId: runId ?? null, recorded: 0, skipped: "no completed run" };
  }

  const rows = await db
    .select()
    .from(screenStock)
    .where(and(eq(screenStock.runId, run.id), eq(screenStock.processed, true)));
  const picks = rows.filter(isSurvivor);
  if (!picks.length) return { runId: run.id, recorded: 0, skipped: "no survivors" };

  const from = new Date(run.runAt.getTime() - 10 * 86400000);
  const symbols = [...new Set([...picks.map((p) => p.symbol), BENCHMARK_SYMBOL])];
  const barMap = new Map<string, PriceBar[]>();
  for (let i = 0; i < symbols.length; i += 4) {
    const chunk = symbols.slice(i, i + 4);
    const bars = await Promise.all(chunk.map((s) => fetchBars(s, from, new Date())));
    chunk.forEach((s, j) => barMap.set(s, bars[j]));
  }

  const benchmarkBars = barMap.get(BENCHMARK_SYMBOL) ?? [];
  let recorded = 0;
  const upserts: Promise<unknown>[] = [];
  for (const horizon of HORIZON_SESSIONS) {
    const benchmark = benchmarkBars.length
      ? horizonReturn(benchmarkBars, run.runAt, horizon)
      : null;
    if (!benchmark) continue; // window not elapsed yet (or no benchmark data)
    for (const pick of picks) {
      const bars = barMap.get(pick.symbol);
      const outcome = bars ? horizonReturn(bars, run.runAt, horizon) : null;
      if (!outcome) continue;
      recorded += 1;
      upserts.push(
        db
          .insert(screenOutcome)
          .values({
            runId: run.id,
            symbol: pick.symbol,
            strict: pick.strict,
            horizonDays: horizon,
            priceAtRun: outcome.priceAtRun,
            priceAtEnd: outcome.priceAtEnd,
            returnPct: outcome.returnPct,
            benchmarkReturnPct: benchmark.returnPct,
            excessReturnPct: outcome.returnPct - benchmark.returnPct,
          })
          .onConflictDoUpdate({
            target: [screenOutcome.runId, screenOutcome.symbol, screenOutcome.horizonDays],
            set: {
              priceAtRun: outcome.priceAtRun,
              priceAtEnd: outcome.priceAtEnd,
              returnPct: outcome.returnPct,
              benchmarkReturnPct: benchmark.returnPct,
              excessReturnPct: outcome.returnPct - benchmark.returnPct,
              computedAt: new Date(),
            },
          }),
      );
    }
  }
  for (let i = 0; i < upserts.length; i += 20) {
    await Promise.all(upserts.slice(i, i + 20));
  }
  return { runId: run.id, recorded };
}

type HorizonRecord = {
  horizonDays: number;
  names: number;
  winRate: number | null;
  beatMarketRate: number | null;
  avgReturn: number | null;
  avgExcess: number | null;
};

export type RunRecord = {
  runId: string;
  runAt: string;
  names: number;
  horizons: HorizonRecord[];
};

/** Win/loss record per completed run: win = positive excess vs STOXX 600. */
export async function getScreenRecord(db: Db, limit = 12): Promise<RunRecord[]> {
  const runs = await db
    .select()
    .from(screenRun)
    .where(and(eq(screenRun.status, "done"), eq(screenRun.methodologyVersion, METHODOLOGY_VERSION)))
    .orderBy(desc(screenRun.runAt))
    .limit(limit);

  const records: RunRecord[] = [];
  for (const run of runs) {
    const survivors = await db
      .select({ id: screenStock.id })
      .from(screenStock)
      .where(and(eq(screenStock.runId, run.id), eq(screenStock.processed, true)));
    const outcomes = await db.select().from(screenOutcome).where(eq(screenOutcome.runId, run.id));

    const horizons: HorizonRecord[] = HORIZON_SESSIONS.map((horizon) => {
      const rows = outcomes.filter((o) => o.horizonDays === horizon);
      if (!rows.length) {
        return {
          horizonDays: horizon,
          names: 0,
          winRate: null,
          beatMarketRate: null,
          avgReturn: null,
          avgExcess: null,
        };
      }
      const wins = rows.filter((r) => r.returnPct > 0).length;
      const beats = rows.filter((r) => r.excessReturnPct > 0).length;
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      return {
        horizonDays: horizon,
        names: rows.length,
        winRate: wins / rows.length,
        beatMarketRate: beats / rows.length,
        avgReturn: avg(rows.map((r) => r.returnPct)),
        avgExcess: avg(rows.map((r) => r.excessReturnPct)),
      };
    });
    records.push({
      runId: run.id,
      runAt: run.runAt.toISOString(),
      names: survivors.length,
      horizons,
    });
  }
  return records;
}
