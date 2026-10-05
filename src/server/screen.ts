import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { screenRun, screenStock, type ScreenStock } from "../lib/schema";
import { advanceScreen } from "../lib/screen/run";
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
  rows: ScreenStock[];
  entered: string[];
  exited: string[];
};

export const getScreenDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<ScreenDashboard> => {
    const db = getDb();
    const [run] = await db.select().from(screenRun).orderBy(desc(screenRun.runAt)).limit(1);
    if (!run) return { run: null, rows: [], entered: [], exited: [] };

    const rows = await db
      .select()
      .from(screenStock)
      .where(eq(screenStock.runId, run.id))
      .orderBy(desc(screenStock.composite));

    const survivors = rows.filter((r) => r.passUniverse && r.passRevision && r.passQuality);
    const [prevRun] = await db
      .select()
      .from(screenRun)
      .where(and(eq(screenRun.status, "done")))
      .orderBy(desc(screenRun.runAt))
      .limit(2);
    let entered: string[] = [];
    let exited: string[] = [];
    if (prevRun && prevRun.id !== run.id) {
      const prevRows = await db
        .select({ symbol: screenStock.symbol, strict: screenStock.strict })
        .from(screenStock)
        .where(eq(screenStock.runId, prevRun.id));
      const prevSurvivors = new Set(prevRows.filter((r) => r.strict).map((r) => r.symbol));
      const currentStrict = new Set(survivors.filter((r) => r.strict).map((r) => r.symbol));
      entered = [...currentStrict].filter((s) => !prevSurvivors.has(s));
      exited = [...prevSurvivors].filter((s) => !currentStrict.has(s));
    }

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
      rows,
      entered,
      exited,
    };
  },
);

export const advanceScreenRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (!context.isAdmin) {
      throw new Error("admin only");
    }
    return advanceScreen(getDb());
  });
