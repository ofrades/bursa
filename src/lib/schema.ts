import { sqliteTable, text, integer, real, index, unique } from "drizzle-orm/sqlite-core";

const now = () => new Date();

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const user = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  image: text("image"),
  analysisCredits: integer("analysis_credits").notNull().default(0), // legacy — keep for migration
  walletBalance: integer("wallet_balance").notNull().default(0), // cents (€1 = 100)
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  subscriptionStatus: text("subscription_status"), // active | canceled | past_due
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export const oauthState = sqliteTable(
  "oauth_state",
  {
    state: text("state").primaryKey(),
    codeVerifier: text("code_verifier").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("idx_oauth_state_created").on(t.createdAt)],
);

// ─── Stock catalog ────────────────────────────────────────────────────────────

export const stock = sqliteTable("stock", {
  symbol: text("symbol").primaryKey(),
  name: text("name"),
  exchange: text("exchange"),
  sector: text("sector"),
  industry: text("industry"),
  nextCheckAt: integer("next_check_at", { mode: "timestamp" }),
  lastAnalyzedAt: integer("last_analyzed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

// ─── Metrics (updated during analysis refreshes) ───────────────────────────────
// Pure price-performance numbers — no AI, no opinion.

export const stockMetrics = sqliteTable("stock_metrics", {
  symbol: text("symbol")
    .primaryKey()
    .references(() => stock.symbol, { onDelete: "cascade" }),
  // Performance %
  perfWtd: real("perf_wtd"), // week-to-date (Mon → now)
  perfLastWeek: real("perf_last_week"), // last full Mon–Fri week
  perfMtd: real("perf_mtd"), // month-to-date
  perfLastMonth: real("perf_last_month"),
  perfYtd: real("perf_ytd"), // year-to-date
  perfLastYear: real("perf_last_year"),
  // Momentum summary: 'up' | 'mixed' | 'down'
  momentumSignal: text("momentum_signal"),
  // Key price levels
  currentPrice: real("current_price"),
  sma20: real("sma20"),
  sma50: real("sma50"),
  sma200: real("sma200"),
  // Oscillators
  rsi14: real("rsi14"), // >70 overbought, <30 oversold
  macdLine: real("macd_line"), // EMA12 - EMA26
  macdSignal: real("macd_signal"), // EMA9 of MACD line
  macdHistogram: real("macd_histogram"), // MACD - Signal (momentum direction)
  atr14: real("atr14"), // Average True Range 14d (stop-loss sizing)
  // Volume
  relativeVolume: real("relative_volume"), // avgVol5 / avgVol20 — spike confirms cycle transition
  // 52-week position
  pct52wHigh: real("pct_52w_high"), // % below 52w high (negative = how far from top)
  pct52wLow: real("pct_52w_low"), // % above 52w low (positive = how far from bottom)
  // Fundamental
  peRatio: real("pe_ratio"),
  forwardPe: real("forward_pe"),
  debtToEquity: real("debt_to_equity"),
  profitMargin: real("profit_margin"),
  returnOnEquity: real("return_on_equity"),
  revenueGrowthYoy: real("revenue_growth_yoy"),
  freeCashflowYield: real("free_cashflow_yield"),
  marketCap: real("market_cap"),
  // Calendar
  nextEarningsDate: text("next_earnings_date"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

// ─── AI memory (per symbol, accumulates over time) ───────────────────────────

export const stockMemory = sqliteTable("stock_memory", {
  symbol: text("symbol")
    .primaryKey()
    .references(() => stock.symbol, { onDelete: "cascade" }),
  content: text("content").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

// ─── Global stock analysis (no user_id — shared across all users) ─────────────

export const stockAnalysis = sqliteTable(
  "stock_analysis",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    symbol: text("symbol")
      .notNull()
      .references(() => stock.symbol, { onDelete: "cascade" }),
    weekStart: text("week_start").notNull(),
    weekEnd: text("week_end").notNull(),
    signal: text("signal").notNull(), // BUY | SELL
    // Market cycle context — the "why" behind the signal
    cycle: text("cycle"), // ACCUMULATION | MARKUP | DISTRIBUTION | MARKDOWN
    cycleTimeframe: text("cycle_timeframe"), // SHORT | MEDIUM | LONG
    cycleStrength: real("cycle_strength"), // 0–100 conviction in cycle phase
    confidence: real("confidence"),
    reasoning: text("reasoning"), // full JSON from AI
    priceAtAnalysis: real("price_at_analysis"),
    lastTriggeredByUserId: text("last_triggered_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    unique("uq_analysis_symbol_week").on(t.symbol, t.weekStart),
    index("idx_analysis_symbol").on(t.symbol),
  ],
);

// ─── Daily signal updates ─────────────────────────────────────────────────────

export const dailySignal = sqliteTable(
  "daily_signal",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    stockAnalysisId: text("stock_analysis_id")
      .notNull()
      .references(() => stockAnalysis.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    signal: text("signal").notNull(), // BUY | SELL
    cycle: text("cycle"), // ACCUMULATION | MARKUP | DISTRIBUTION | MARKDOWN
    note: text("note"),
    priceAtUpdate: real("price_at_update"),
    signalChanged: integer("signal_changed", { mode: "boolean" }).default(false),
    trigger: text("trigger").notNull().default("manual"), // 'manual'|'auto:price'|'auto:earnings'
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("idx_daily_signal_analysis").on(t.stockAnalysisId)],
);

// ─── Board of Supervisors ─────────────────────────────────────────────────────
// Two permanent seat holders with radically different lenses.
// Taleb: tail risk, fragility, black swans (only fires on extremes).
// Buffett: fundamentals, moat, margin of safety (always opines).

export const supervisorAlert = sqliteTable(
  "supervisor_alert",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    symbol: text("symbol")
      .notNull()
      .references(() => stock.symbol, { onDelete: "cascade" }),
    stockAnalysisId: text("stock_analysis_id")
      .notNull()
      .references(() => stockAnalysis.id, { onDelete: "cascade" }),
    supervisor: text("supervisor").notNull(), // 'TALEB' | 'BUFFETT'
    // Taleb types: BLACK_SWAN_BUY | BLACK_SWAN_SELL | FRAGILE | ANTIFRAGILE | NONE
    // Buffett types: MARGIN_OF_SAFETY | OVERPRICED | STRONG_MOAT | NO_MOAT | RATIONAL_HOLD | RATIONAL_AVOID
    alertType: text("alert_type").notNull(),
    severity: text("severity").notNull(), // 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'
    title: text("title").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("idx_supervisor_alert_symbol").on(t.symbol),
    index("idx_supervisor_alert_analysis").on(t.stockAnalysisId),
  ],
);

// ─── User watchlist ───────────────────────────────────────────────────────────

export const watchlist = sqliteTable(
  "watchlist",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => stock.symbol, { onDelete: "cascade" }),
    addedAt: integer("added_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [unique("uq_watchlist_user_symbol").on(t.userId, t.symbol)],
);

// ─── Usage log (per-analysis cost tracking) ───────────────────────────────────

export const usageLog = sqliteTable(
  "usage_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull(),
    symbol: text("symbol").notNull(),
    model: text("model").notNull(), // actual model used
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    providerCostUsd: real("provider_cost_usd"),
    costCents: integer("cost_cents").notNull(), // billed amount deducted from wallet in EUR cents
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("idx_usage_log_user").on(t.userId), index("idx_usage_log_symbol").on(t.symbol)],
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type User = typeof user.$inferSelect;
export type Stock = typeof stock.$inferSelect;
export type StockMetrics = typeof stockMetrics.$inferSelect;
export type StockMemory = typeof stockMemory.$inferSelect;
export type StockAnalysis = typeof stockAnalysis.$inferSelect;
export type DailySignal = typeof dailySignal.$inferSelect;
export type SupervisorAlert = typeof supervisorAlert.$inferSelect;
export type Watchlist = typeof watchlist.$inferSelect;
export type UsageLog = typeof usageLog.$inferSelect;
