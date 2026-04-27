import * as schema from "./schema";

let _db: Awaited<ReturnType<typeof buildDb>> | null = null;

function resolveDbPath() {
  const raw = process.env.DB_PATH || process.env.DATABASE_URL || "./data/stocktrack.sqlite";
  return raw.startsWith("file:") ? raw.slice("file:".length) : raw;
}

/**
 * Additive schema migrations — safe to run on every cold start.
 * ALTER TABLE ADD COLUMN silently no-ops if the column already exists,
 * and CREATE TABLE/INDEX IF NOT EXISTS handles the new table.
 * This keeps prod SQLite in sync without a full migration framework.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runMigrations(sqlite: any) {
  const addCol = (table: string, col: string, type: string) => {
    try {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      // column already exists — fine
    }
  };

  // stock_analysis — cycle context
  addCol("stock_analysis", "cycle", "text");
  addCol("stock_analysis", "cycle_timeframe", "text");
  addCol("stock_analysis", "cycle_strength", "real");

  // daily_signal — cycle
  addCol("daily_signal", "cycle", "text");

  // stock_metrics — oscillators, volume, 52w position, extended fundamentals
  addCol("stock_metrics", "perf_day", "real");
  addCol("stock_metrics", "sma200", "real");
  addCol("stock_metrics", "rsi14", "real");
  addCol("stock_metrics", "macd_line", "real");
  addCol("stock_metrics", "macd_signal", "real");
  addCol("stock_metrics", "macd_histogram", "real");
  addCol("stock_metrics", "atr14", "real");
  addCol("stock_metrics", "relative_volume", "real");
  addCol("stock_metrics", "pct_52w_high", "real");
  addCol("stock_metrics", "pct_52w_low", "real");
  addCol("stock_metrics", "return_on_equity", "real");
  addCol("stock_metrics", "revenue_growth_yoy", "real");
  addCol("stock_metrics", "free_cashflow_yield", "real");

  // supervisor_alert — new table (board of supervisors)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS supervisor_alert (
      id text PRIMARY KEY NOT NULL,
      symbol text NOT NULL,
      stock_analysis_id text NOT NULL,
      supervisor text NOT NULL,
      alert_type text NOT NULL,
      severity text NOT NULL,
      title text NOT NULL,
      content text NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (symbol) REFERENCES stock(symbol) ON DELETE cascade,
      FOREIGN KEY (stock_analysis_id) REFERENCES stock_analysis(id) ON DELETE cascade
    )
  `);
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS idx_supervisor_alert_symbol ON supervisor_alert (symbol)`,
  );
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS idx_supervisor_alert_analysis ON supervisor_alert (stock_analysis_id)`,
  );

  // wallet migration — additive
  addCol("user", "wallet_balance", "integer NOT NULL DEFAULT 0");

  // watchlist -> saved/watching tiers
  addCol("watchlist", "is_saved", "integer NOT NULL DEFAULT 1");
  addCol("watchlist", "is_watching", "integer NOT NULL DEFAULT 1");

  // usage_log — per-analysis cost tracking
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS usage_log (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      symbol text NOT NULL,
      model text NOT NULL,
      prompt_tokens integer,
      completion_tokens integer,
      total_tokens integer,
      provider_cost_usd real,
      cost_cents integer NOT NULL,
      created_at integer NOT NULL
    )
  `);
  addCol("usage_log", "provider_cost_usd", "real");
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_usage_log_user ON usage_log (user_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_usage_log_symbol ON usage_log (symbol)`);
}

async function buildDb() {
  const [{ default: Database }, { drizzle }, fs, path] = await Promise.all([
    import("better-sqlite3"),
    import("drizzle-orm/better-sqlite3"),
    import("node:fs/promises"),
    import("node:path"),
  ]);

  const dbPath = resolveDbPath();
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sqlite = new (Database as any)(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  runMigrations(sqlite);

  return drizzle(sqlite, { schema });
}

export async function getDb() {
  if (!_db) _db = await buildDb();
  return _db;
}

export function getDbPath() {
  return resolveDbPath();
}
