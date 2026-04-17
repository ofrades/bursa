import { sqliteTable, text, integer, real, index, unique } from 'drizzle-orm/sqlite-core'

const now = () => new Date()

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const user = sqliteTable('user', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  image: text('image'),
  analysisCredits: integer('analysis_credits').notNull().default(0),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripePriceId: text('stripe_price_id'),
  subscriptionStatus: text('subscription_status'), // active | canceled | past_due
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
})

export const oauthState = sqliteTable(
  'oauth_state',
  {
    state: text('state').primaryKey(),
    codeVerifier: text('code_verifier').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
  },
  (t) => [index('idx_oauth_state_created').on(t.createdAt)],
)

// ─── Stock catalog ────────────────────────────────────────────────────────────
// One row per symbol. isPlatform = true means it's always analyzed regardless
// of whether any user has it in their watchlist.

export const stock = sqliteTable('stock', {
  symbol: text('symbol').primaryKey(),
  name: text('name'),
  exchange: text('exchange'),
  sector: text('sector'),
  industry: text('industry'),
  // Scheduler: when to next run analysis (null = run tonight)
  nextCheckAt: integer('next_check_at', { mode: 'timestamp' }),
  lastAnalyzedAt: integer('last_analyzed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
})

// ─── Simple man metrics (updated each nightly analysis) ───────────────────────
// Pure price-performance numbers — no AI, no opinion.

export const stockMetrics = sqliteTable('stock_metrics', {
  symbol: text('symbol').primaryKey().references(() => stock.symbol, { onDelete: 'cascade' }),
  // Performance %
  perfWtd: real('perf_wtd'),           // week-to-date (Mon → now)
  perfLastWeek: real('perf_last_week'), // last full Mon–Fri week
  perfMtd: real('perf_mtd'),           // month-to-date
  perfLastMonth: real('perf_last_month'),
  perfYtd: real('perf_ytd'),           // year-to-date
  perfLastYear: real('perf_last_year'),
  // Momentum summary: 'up' | 'mixed' | 'down'
  momentumSignal: text('momentum_signal'),
  // Key price levels
  currentPrice: real('current_price'),
  sma20: real('sma20'),
  sma50: real('sma50'),
  // Fundamental
  peRatio: real('pe_ratio'),
  forwardPe: real('forward_pe'),
  debtToEquity: real('debt_to_equity'),
  profitMargin: real('profit_margin'),
  marketCap: real('market_cap'),
  // Calendar
  nextEarningsDate: text('next_earnings_date'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
})

// ─── AI memory (per symbol, accumulates over time) ───────────────────────────

export const stockMemory = sqliteTable('stock_memory', {
  symbol: text('symbol').primaryKey().references(() => stock.symbol, { onDelete: 'cascade' }),
  content: text('content').notNull().default(''),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
})

// ─── Global stock analysis (no user_id — shared across all users) ─────────────

export const stockAnalysis = sqliteTable(
  'stock_analysis',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    symbol: text('symbol').notNull().references(() => stock.symbol, { onDelete: 'cascade' }),
    weekStart: text('week_start').notNull(),
    weekEnd: text('week_end').notNull(),
    signal: text('signal').notNull(),       // STRONG_BUY | BUY | HOLD | SELL | STRONG_SELL
    confidence: real('confidence'),
    reasoning: text('reasoning'),           // full JSON from AI
    priceAtAnalysis: real('price_at_analysis'),
    lastTriggeredByUserId: text('last_triggered_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
  },
  (t) => [
    unique('uq_analysis_symbol_week').on(t.symbol, t.weekStart),
    index('idx_analysis_symbol').on(t.symbol),
  ],
)

// ─── Daily signal updates ─────────────────────────────────────────────────────

export const dailySignal = sqliteTable(
  'daily_signal',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    stockAnalysisId: text('stock_analysis_id')
      .notNull()
      .references(() => stockAnalysis.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    date: text('date').notNull(),           // YYYY-MM-DD
    signal: text('signal').notNull(),
    note: text('note'),
    priceAtUpdate: real('price_at_update'),
    signalChanged: integer('signal_changed', { mode: 'boolean' }).default(false),
    trigger: text('trigger').notNull().default('manual'), // 'manual'|'auto:price'|'auto:earnings'
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
  },
  (t) => [index('idx_daily_signal_analysis').on(t.stockAnalysisId)],
)

// ─── User watchlist (personal, references stock catalog) ─────────────────────

export const watchlist = sqliteTable(
  'watchlist',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull().references(() => stock.symbol, { onDelete: 'cascade' }),
    addedAt: integer('added_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
  },
  (t) => [unique('uq_watchlist_user_symbol').on(t.userId, t.symbol)],
)

// ─── Types ────────────────────────────────────────────────────────────────────

export type User = typeof user.$inferSelect
export type Stock = typeof stock.$inferSelect
export type StockMetrics = typeof stockMetrics.$inferSelect
export type StockMemory = typeof stockMemory.$inferSelect
export type StockAnalysis = typeof stockAnalysis.$inferSelect
export type DailySignal = typeof dailySignal.$inferSelect
export type Watchlist = typeof watchlist.$inferSelect
