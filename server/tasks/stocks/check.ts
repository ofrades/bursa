/**
 * check.ts — Nitro task: event-driven stock check during market hours
 *
 * Schedule: every 30 min Mon-Fri 9:00-17:00 server time
 * Config: scheduledTasks: { '0,30 9-16 * * 1-5': 'stocks:check' }
 *
 * Detects:
 *   - Price move > 4% today → queue daily update
 *   - Earnings within 48h → flag + queue daily update
 */

import { defineTask } from 'nitro/task'
import { parseAiJson, splitMemoryUpdate } from '../../../src/lib/ai-parse'
import { isMarketHours, isEarningsSoon } from './helpers'

export default defineTask({
  meta: {
    name: 'stocks:check',
    description: 'Event-driven check: price moves and earnings proximity',
  },
  async run() {
    if (!isMarketHours()) {
      console.log('[stocks:check] Outside market hours, skipping.')
      return { result: 'skipped' }
    }

    console.log('[stocks:check] Running event check…')

    const [{ getDb }, { sql, eq, and }, { watchlist, weeklyRecommendation, dailyUpdate, stockMemory }] = await Promise.all([
      import('../../../src/lib/db'),
      import('drizzle-orm'),
      import('../../../src/lib/schema'),
    ])

    const db = await getDb()
    const { format, startOfWeek } = await import('date-fns')
    const today = new Date()
    const todayStr = format(today, 'yyyy-MM-dd')
    const weekStart = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')

    const items = await db.select({ userId: watchlist.userId, symbol: watchlist.symbol }).from(watchlist)

    const { default: YahooFinance } = await import('yahoo-finance2')
    const yf = new YahooFinance()

    let triggered = 0
    for (const item of items) {
      try {
        const [quote, summary] = await Promise.all([
          yf.quote(item.symbol) as Promise<any>,
          (yf.quoteSummary(item.symbol, { modules: ['calendarEvents'] }) as Promise<any>).catch(() => null),
        ])

        const pct = Math.abs(quote.regularMarketChangePercent ?? 0)
        const earningsDate = summary?.calendarEvents?.earnings?.earningsDate?.[0]
          ? new Date(summary.calendarEvents.earnings.earningsDate[0])
          : null
        const earningsSoon = isEarningsSoon(earningsDate, 48)
        const bigMove = pct >= 4

        if (!bigMove && !earningsSoon) continue

        // Find current week's recommendation
        const [rec] = await db.select().from(weeklyRecommendation).where(
          and(eq(weeklyRecommendation.userId, item.userId), eq(weeklyRecommendation.symbol, item.symbol), eq(weeklyRecommendation.weekStart, weekStart))
        )

        if (!rec) continue // no weekly rec yet, skip

        // Check if we already ran a daily update today
        const todayUpdates = await db.select().from(dailyUpdate).where(
          and(eq(dailyUpdate.weeklyRecommendationId, rec.id), eq(dailyUpdate.date, todayStr))
        )
        if (todayUpdates.length > 0) continue // already checked today

        // Trigger a quick daily update
        const reason = bigMove
          ? `Price moved ${quote.regularMarketChangePercent?.toFixed(1)}% today`
          : `Earnings ${earningsDate?.toDateString()} is within 48 hours`

        console.log(`[stocks:check] Triggering update for ${item.symbol}: ${reason}`)

        const [memRow] = await db.select().from(stockMemory).where(eq(stockMemory.symbol, item.symbol))
        const { buildInitialMemory } = await import('../../../src/server/memory')
        const memory = memRow?.content ?? buildInitialMemory(item.symbol)

        const { chat } = await import('@tanstack/ai')
        const { createOpenaiChat } = await import('@tanstack/ai-openai')

        const prompt = `You are a stock analyst. Event detected for ${item.symbol}: ${reason}.

## MEMORY
${memory}

Current price: $${quote.regularMarketPrice?.toFixed(2)} (${quote.regularMarketChangePercent?.toFixed(2)}% today)
Weekly signal was: ${rec.signal}

Has the signal changed? Respond only with JSON:
{"signal":"BUY"|"HOLD"|"SELL","confidence":<0-100>,"reasoning":"<2 sentences>","signalChanged":<boolean>,"weeklyOutlook":"<1 sentence>"}`

        const adapter = createOpenaiChat('z-ai/glm-5.1' as any, process.env.OPENROUTER_API_KEY ?? '', { baseURL: 'https://openrouter.ai/api/v1' })
        const text = await chat({ adapter, messages: [{ role: 'user', content: prompt }], stream: false, maxTokens: 400 })

        let parsed: any
        try { parsed = parseAiJson(text) }
        catch { continue }

        const { randomUUID } = await import('crypto')
        await db.insert(dailyUpdate).values({
          id: randomUUID(),
          weeklyRecommendationId: rec.id,
          symbol: item.symbol,
          date: todayStr,
          signal: parsed.signal,
          note: `[Auto] ${reason}. ${parsed.reasoning}`,
          priceAtUpdate: quote.regularMarketPrice ?? null,
          signalChanged: parsed.signalChanged ?? (parsed.signal !== rec.signal),
          createdAt: new Date(),
        })

        triggered++
        await new Promise((r) => setTimeout(r, 1500))
      } catch (err) {
        console.error(`[stocks:check] Error for ${item.symbol}:`, err)
      }
    }

    console.log(`[stocks:check] Done. ${triggered} updates triggered.`)
    return { result: 'ok', triggered }
  },
})
