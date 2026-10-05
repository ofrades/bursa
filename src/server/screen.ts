import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { screenRun, screenStock, type ScreenStock } from "../lib/schema";
import { classifyLatestRun } from "../lib/screen/jev";
import { getScreenRecord, type RunRecord } from "../lib/screen/outcomes";

export type { RunRecord };
import { advanceScreen } from "../lib/screen/run";
import { compareRuns, METHODOLOGY_VERSION } from "../lib/screen/report";
import { authMiddleware } from "./middleware";

export type ScreenDashboard = {
  run: {
    id: string;
    runAt: string;
    status: string;
    universeCount: number;
    processedCount: number;
    passedUniverse: number;
    passedRevision: number;
    survivorCount: number;
  } | null;
  latest: { status: string; processedCount: number; universeCount: number; runAt: string } | null;
  previousRunAt: string | null;
  rows: ScreenStock[];
  entered: string[];
  exited: string[];
  changes: Record<string, { revision: number | null; composite: number | null }>;
};

export const getScreenDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<ScreenDashboard> => {
    const db = getDb();
    const [latest] = await db
      .select()
      .from(screenRun)
      .where(eq(screenRun.methodologyVersion, METHODOLOGY_VERSION))
      .orderBy(desc(screenRun.runAt))
      .limit(1);
    const [run, previous] = await db
      .select()
      .from(screenRun)
      .where(
        and(eq(screenRun.status, "done"), eq(screenRun.methodologyVersion, METHODOLOGY_VERSION)),
      )
      .orderBy(desc(screenRun.runAt))
      .limit(2);
    const latestStatus = latest
      ? {
          status: latest.status,
          processedCount: latest.processedCount,
          universeCount: latest.universeCount,
          runAt: latest.runAt.toISOString(),
        }
      : null;
    if (!run)
      return {
        run: null,
        latest: latestStatus,
        previousRunAt: null,
        rows: [],
        entered: [],
        exited: [],
        changes: {},
      };
    const rows = await db
      .select()
      .from(screenStock)
      .where(eq(screenStock.runId, run.id))
      .orderBy(desc(screenStock.composite));
    const previousRows = previous
      ? await db.select().from(screenStock).where(eq(screenStock.runId, previous.id))
      : [];
    const comparison = previous
      ? compareRuns(rows, previousRows)
      : { entered: [], exited: [], changes: {} };
    return {
      run: {
        id: run.id,
        runAt: run.runAt.toISOString(),
        status: run.status,
        universeCount: run.universeCount,
        processedCount: run.processedCount,
        passedUniverse: run.passedUniverse,
        passedRevision: run.passedRevision,
        survivorCount: run.survivorCount,
      },
      latest: latestStatus,
      previousRunAt: previous?.runAt.toISOString() ?? null,
      rows,
      ...comparison,
    };
  },
);

export const classifyScreenSurvivors = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (!context.isAdmin) throw new Error("admin only");
    return classifyLatestRun(getDb());
  });

export const advanceScreenRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ runId: z.string().uuid().optional() }))
  .handler(async ({ context, data }) => {
    if (!context.isAdmin) throw new Error("admin only");
    return advanceScreen(getDb(), data.runId);
  });

export const getScreenTrackRecord = createServerFn({ method: "GET" }).handler(
  async (): Promise<RunRecord[]> => getScreenRecord(getDb()),
);
