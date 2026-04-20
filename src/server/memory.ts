import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { stockMemory } from "../lib/schema";
import { authMiddleware } from "./middleware";

/**
 * Build an initial memory document for a stock.
 * The AI will progressively enrich this over time.
 */
export function buildInitialMemory(symbol: string): string {
  return `# ${symbol} — Stock Memory

## Investment Thesis
*Not yet established. Will be set after first analysis.*

## Key Levels
- Support: TBD
- Resistance: TBD

## Upcoming Events
*None recorded yet.*

## Recommendation History
*No recommendations yet.*

## Accumulated Context
*No context yet. Will accumulate news, events, and observations over time.*
`;
}

export const getStockMemory = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data: { symbol: string }) => data)
  .handler(async ({ data }) => {
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    const [row] = await db.select().from(stockMemory).where(eq(stockMemory.symbol, data.symbol));
    return row?.content ?? buildInitialMemory(data.symbol);
  });

export const saveStockMemory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { symbol: string; content: string }) => data)
  .handler(async ({ data }) => {
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    await db
      .insert(stockMemory)
      .values({ symbol: data.symbol, content: data.content, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: stockMemory.symbol,
        set: { content: data.content, updatedAt: new Date() },
      });
    return { ok: true };
  });
