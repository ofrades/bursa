/**
 * nightly.ts — Single nightly Nitro task that handles all scheduling smartly.
 *
 * Schedule: nightly at 23:00 (configures itself via next_check_at per stock)
 *
 * Logic:
 *   1. Collect all symbols any user has added — analysis is shared across users
 *   2. For each: skip if next_check_at > now (not due yet)
 *   3. Run analysis, compute metrics, update memory
 *   4. Set next_check_at based on upcoming calendar events:
 *      - Earnings in ≤3 days  → day before earnings at 09:00
 *      - Earnings in ≤7 days  → 2 days before at 09:00
 *      - Otherwise            → next Monday at 23:00
 */

import { defineTask } from "nitro/task";
import { parseAiJson, splitMemoryUpdate } from "../../../src/lib/ai-parse";

export default defineTask({
  meta: {
    name: "stocks:nightly",
    description: "Smart nightly analysis — respects per-stock next_check_at",
  },
  async run() {
    console.log("[stocks:nightly] Starting…");

    const [{ getDb }, { eq, or, lte, isNull, inArray, sql }, schema] =
      await Promise.all([
        import("../../../src/lib/db"),
        import("drizzle-orm"),
        import("../../../src/lib/schema"),
      ]);
    const {
      stock,
      watchlist,
      stockAnalysis,
      stockMemory,
      stockMetrics,
      dailySignal,
    } = schema;

    const db = await getDb();
    const now = new Date();

    // All distinct symbols that any user has added — analysis is shared
    const watchlistSymbols = await db
      .select({ symbol: watchlist.symbol })
      .from(watchlist);
    const allSymbols = [...new Set(watchlistSymbols.map((s) => s.symbol))];

    if (!allSymbols.length) {
      console.log("[stocks:nightly] No symbols to check.");
      return { result: "ok", checked: 0 };
    }

    // Filter: only those due (next_check_at <= now OR null)
    const due = await db
      .select({ symbol: stock.symbol, nextCheckAt: stock.nextCheckAt })
      .from(stock)
      .where(or(isNull(stock.nextCheckAt), lte(stock.nextCheckAt, now)));
    const dueSet = new Set(due.map((d) => d.symbol));
    const toCheck = allSymbols.filter((s) => dueSet.has(s));

    console.log(
      `[stocks:nightly] ${allSymbols.length} total symbols, ${toCheck.length} due for analysis`,
    );

    const { format, startOfWeek, endOfWeek } = await import("date-fns");
    const weekStart = format(
      startOfWeek(now, { weekStartsOn: 1 }),
      "yyyy-MM-dd",
    );
    const weekEnd = format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");

    const { default: YahooFinance } = await import("yahoo-finance2");
    const yf = new YahooFinance();

    const { buildInitialMemory } = await import("../../../src/server/memory");
    const { refreshStockMetrics } = await import("../../../src/lib/metrics");
    const { chat } = await import("@tanstack/ai");
    const { createOpenaiChat } = await import("@tanstack/ai-openai");
    const { randomUUID } = await import("crypto");

    let done = 0,
      skipped = 0,
      failed = 0;

    for (const symbol of toCheck) {
      try {
        // Gather data
        const period1 = new Date(now);
        period1.setDate(period1.getDate() - 90);

        const [quote, historical, summary] = await Promise.all([
          yf.quote(symbol) as Promise<any>,
          (
            yf.historical(symbol, {
              period1,
              period2: now,
              interval: "1d",
            }) as Promise<any[]>
          ).catch(() => []),
          (
            yf.quoteSummary(symbol, {
              modules: ["financialData", "calendarEvents", "assetProfile"],
            }) as Promise<any>
          ).catch(() => null),
        ]);

        const price: number = quote.regularMarketPrice ?? 0;
        const earningsRaw =
          summary?.calendarEvents?.earnings?.earningsDate?.[0];
        const earningsDate = earningsRaw ? new Date(earningsRaw) : null;

        // Compute metrics
        const metrics = await refreshStockMetrics(symbol);

        // Read memory
        const [memRow] = await db
          .select()
          .from(stockMemory)
          .where(eq(stockMemory.symbol, symbol));
        const memory = memRow?.content ?? buildInitialMemory(symbol);

        const metricsStr = `WTD: ${metrics.perfWtd?.toFixed(1) ?? "N/A"}% | Last week: ${metrics.perfLastWeek?.toFixed(1) ?? "N/A"}%
MTD: ${metrics.perfMtd?.toFixed(1) ?? "N/A"}% | Last month: ${metrics.perfLastMonth?.toFixed(1) ?? "N/A"}%
YTD: ${metrics.perfYtd?.toFixed(1) ?? "N/A"}% | Last year: ${metrics.perfLastYear?.toFixed(1) ?? "N/A"}%
Momentum: ${metrics.momentumSignal?.toUpperCase() ?? "UNKNOWN"}`;

        const closes = (historical as any[])
          .map((h: any) => h.close)
          .filter(Boolean) as number[];
        const sma20 =
          closes.length >= 20
            ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20
            : null;
        const sma50 =
          closes.length >= 50
            ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50
            : null;

        const prompt = `You are an expert stock analyst with persistent memory.

## STOCK MEMORY
${memory}

## SIMPLE MAN METRICS
${metricsStr}

## CURRENT DATA
${symbol} | ${summary?.assetProfile?.sector ?? "Unknown"} | Price: $${price.toFixed(2)} (${quote.regularMarketChangePercent?.toFixed(2) ?? 0}%)
52W: $${quote.fiftyTwoWeekLow?.toFixed(0) ?? "N/A"}–$${quote.fiftyTwoWeekHigh?.toFixed(0) ?? "N/A"} | P/E: ${quote.trailingPE?.toFixed(1) ?? "N/A"} | D/E: ${summary?.financialData?.debtToEquity?.toFixed(1) ?? "N/A"}
vs SMA20: ${sma20 ? (((price - sma20) / sma20) * 100).toFixed(1) + "%" : "N/A"} | vs SMA50: ${sma50 ? (((price - sma50) / sma50) * 100).toFixed(1) + "%" : "N/A"}
Next earnings: ${earningsDate?.toDateString() ?? "N/A"}

CONTEXT: Weekly recommendation for ${weekStart}–${weekEnd}. Flag any conflict between momentum and fundamentals.

Respond with:
1. JSON: {"signal":"BUY"|"HOLD"|"SELL","confidence":<0-100>,"weeklyOutlook":"<2 sentences>","keyBullishFactors":["<f>","<f>"],"keyBearishFactors":["<f>","<f>"],"riskLevel":"LOW"|"MEDIUM"|"HIGH","priceTarget":<n|null>,"stopLoss":<n|null>,"reasoning":"<2-3 sentences>","signalChanged":false}
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
          console.warn(`[stocks:nightly] Bad JSON for ${symbol}`);
          failed++;
          continue;
        }

        // Upsert analysis
        const existing = await db
          .select()
          .from(stockAnalysis)
          .where(eq(stockAnalysis.symbol, symbol));
        const thisWeek = existing.find((r) => r.weekStart === weekStart);
        const recId = thisWeek?.id ?? randomUUID();

        if (thisWeek) {
          await db
            .update(stockAnalysis)
            .set({
              signal: parsed.signal,
              confidence: parsed.confidence,
              reasoning: JSON.stringify(parsed),
              priceAtAnalysis: price,
              updatedAt: now,
            })
            .where(eq(stockAnalysis.id, recId));
        } else {
          await db
            .insert(stockAnalysis)
            .values({
              id: recId,
              symbol,
              weekStart,
              weekEnd,
              signal: parsed.signal,
              confidence: parsed.confidence,
              reasoning: JSON.stringify(parsed),
              priceAtAnalysis: price,
              createdAt: now,
              updatedAt: now,
            });
        }

        // Update memory
        if (memPart) {
          await db
            .insert(stockMemory)
            .values({ symbol, content: memPart, updatedAt: now })
            .onConflictDoUpdate({
              target: stockMemory.symbol,
              set: { content: memPart, updatedAt: now },
            });
        }

        // Set next_check_at
        let nextCheckAt: Date;
        if (earningsDate) {
          const daysUntil =
            (earningsDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
          if (daysUntil > 0 && daysUntil <= 3) {
            nextCheckAt = new Date(earningsDate);
            nextCheckAt.setDate(nextCheckAt.getDate() - 1);
            nextCheckAt.setHours(9, 0, 0, 0);
          } else if (daysUntil > 0 && daysUntil <= 7) {
            nextCheckAt = new Date(earningsDate);
            nextCheckAt.setDate(nextCheckAt.getDate() - 2);
            nextCheckAt.setHours(9, 0, 0, 0);
          } else {
            const nm = new Date(now);
            nm.setDate(nm.getDate() + ((8 - nm.getDay()) % 7 || 7));
            nm.setHours(23, 0, 0, 0);
            nextCheckAt = nm;
          }
        } else {
          const nm = new Date(now);
          nm.setDate(nm.getDate() + ((8 - nm.getDay()) % 7 || 7));
          nm.setHours(23, 0, 0, 0);
          nextCheckAt = nm;
        }

        await db
          .update(stock)
          .set({ lastAnalyzedAt: now, nextCheckAt })
          .where(eq(stock.symbol, symbol));

        done++;
        await new Promise((r) => setTimeout(r, 2000)); // rate limit courtesy
      } catch (err) {
        console.error(`[stocks:nightly] Failed for ${symbol}:`, err);
        failed++;
      }
    }

    console.log(
      `[stocks:nightly] Done. ${done} analyzed, ${skipped} skipped, ${failed} failed.`,
    );
    return { result: "ok", done, skipped, failed };
  },
});
