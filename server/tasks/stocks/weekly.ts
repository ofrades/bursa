/**
 * weekly.ts — Nitro task: run full weekly analysis for all tracked stocks
 *
 * Schedule: Sunday 22:00 local server time
 * Config in vite.config.ts: scheduledTasks: { '0 22 * * 0': 'stocks:weekly' }
 *
 * For each user's watchlist, generates a fresh weekly recommendation
 * and updates the AI memory for each stock.
 */

import { defineTask } from "nitro/task";
import { parseAiJson, splitMemoryUpdate } from "../../../src/lib/ai-parse";

export default defineTask({
  meta: {
    name: "stocks:weekly",
    description: "Weekly AI analysis for all tracked stocks",
  },
  async run({ payload: _payload }) {
    console.log("[stocks:weekly] Starting weekly analysis…");

    const [{ getDb }, { eq, sql }, { watchlist, weeklyRecommendation, user }] = await Promise.all([
      import("../../../src/lib/db"),
      import("drizzle-orm"),
      import("../../../src/lib/schema"),
    ]);

    const db = await getDb();

    // Get all distinct watchlist items grouped by user
    const items = await db
      .select({
        userId: watchlist.userId,
        symbol: watchlist.symbol,
      })
      .from(watchlist);

    console.log(`[stocks:weekly] Processing ${items.length} watchlist entries`);

    const { format, startOfWeek, endOfWeek } = await import("date-fns");
    const today = new Date();
    const weekStart = format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const weekEnd = format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");

    let done = 0,
      failed = 0;
    for (const item of items) {
      try {
        // Dynamic imports keep Node-only deps out of client bundle
        const { default: YahooFinance } = await import("yahoo-finance2");
        const yf = new YahooFinance();

        const period1 = new Date();
        period1.setDate(period1.getDate() - 90);

        const [quote, historical, summary] = await Promise.all([
          yf.quote(item.symbol),
          (
            yf.historical(item.symbol, {
              period1,
              period2: new Date(),
              interval: "1d",
            }) as Promise<any[]>
          ).catch(() => []),
          (
            yf.quoteSummary(item.symbol, {
              modules: ["financialData", "calendarEvents", "assetProfile", "defaultKeyStatistics"],
            }) as Promise<any>
          ).catch(() => null),
        ]);

        const { chat } = await import("@tanstack/ai");
        const { createOpenaiChat } = await import("@tanstack/ai-openai");

        // Read existing memory
        const { stockMemory } = await import("../../../src/lib/schema");
        const { buildInitialMemory } = await import("../../../src/server/memory");
        const [memRow] = await db
          .select()
          .from(stockMemory)
          .where(eq(stockMemory.symbol, item.symbol));
        const memory = memRow?.content ?? buildInitialMemory(item.symbol);

        // Build simple prompt (reuse pattern from recommend.ts)
        const q = quote as any;
        const price = q.regularMarketPrice ?? 0;
        const prompt = `You are an expert stock analyst with persistent memory.

## STOCK MEMORY
${memory}

## CURRENT DATA
Symbol: ${item.symbol} | Price: $${price?.toFixed(2)} | Change: ${q.regularMarketChangePercent?.toFixed(2)}%
52W: $${q.fiftyTwoWeekLow?.toFixed(0)}–$${q.fiftyTwoWeekHigh?.toFixed(0)} | P/E: ${q.trailingPE?.toFixed(1) ?? "N/A"}
Earnings: ${summary?.calendarEvents?.earnings?.earningsDate?.[0] ? new Date(summary.calendarEvents.earnings.earningsDate[0]).toDateString() : "N/A"}
Sector: ${summary?.assetProfile?.sector ?? "Unknown"}

CONTEXT: Weekly recommendation for ${weekStart}–${weekEnd}.

Respond with:
1. JSON: {"signal":"BUY"|"HOLD"|"SELL","confidence":<0-100>,"weeklyOutlook":"<2 sentences>","keyBullishFactors":["<f>","<f>"],"keyBearishFactors":["<f>","<f>"],"riskLevel":"LOW"|"MEDIUM"|"HIGH","priceTarget":<n|null>,"stopLoss":<n|null>,"reasoning":"<2 sentences>","signalChanged":false}
2. MEMORY_UPDATE: <updated memory markdown>`;

        const adapter = createOpenaiChat(
          "z-ai/glm-5.1" as any,
          process.env.OPENROUTER_API_KEY ?? "",
          { baseURL: "https://openrouter.ai/api/v1" },
        );
        const text = await chat({
          adapter,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          maxTokens: 1200,
        });

        const { jsonPart, memoryUpdate: memPart } = splitMemoryUpdate(text);

        let parsed: any;
        try {
          parsed = parseAiJson(jsonPart);
        } catch {
          console.warn(`[stocks:weekly] Bad JSON for ${item.symbol}`);
          failed++;
          continue;
        }

        // Upsert weekly recommendation
        const existing = await db
          .select()
          .from(weeklyRecommendation)
          .where(
            sql`${weeklyRecommendation.userId} = ${item.userId} AND ${weeklyRecommendation.symbol} = ${item.symbol} AND ${weeklyRecommendation.weekStart} = ${weekStart}`,
          );

        const { randomUUID } = await import("crypto");
        const now = new Date();
        if (existing.length > 0) {
          await db
            .update(weeklyRecommendation)
            .set({
              signal: parsed.signal,
              confidence: parsed.confidence,
              reasoning: JSON.stringify(parsed),
              priceAtRecommendation: price,
              updatedAt: now,
            })
            .where(eq(weeklyRecommendation.id, existing[0].id));
        } else {
          await db.insert(weeklyRecommendation).values({
            id: randomUUID(),
            userId: item.userId,
            symbol: item.symbol,
            weekStart,
            weekEnd,
            signal: parsed.signal,
            confidence: parsed.confidence,
            reasoning: JSON.stringify(parsed),
            priceAtRecommendation: price,
            createdAt: now,
            updatedAt: now,
          });
        }

        if (memPart) {
          await db
            .insert(stockMemory)
            .values({ symbol: item.symbol, content: memPart, updatedAt: now })
            .onConflictDoUpdate({
              target: stockMemory.symbol,
              set: { content: memPart, updatedAt: now },
            });
        }

        done++;
        // Be kind to rate limits
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        console.error(`[stocks:weekly] Failed for ${item.symbol}:`, err);
        failed++;
      }
    }

    console.log(`[stocks:weekly] Done. ${done} succeeded, ${failed} failed.`);
    return { result: "ok", done, failed };
  },
});
