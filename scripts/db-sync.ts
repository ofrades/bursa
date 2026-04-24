#!/usr/bin/env tsx
/**
 * Diff / merge script for syncing analysis data from a local SQLite DB
 * into a production SQLite DB (or any target DB).
 *
 * Usage:
 *   npx tsx scripts/db-sync.ts --diff --local ./data/stocktrack.sqlite --prod ./.tmp/prod-sync.sqlite
 *   npx tsx scripts/db-sync.ts --merge --local ./data/stocktrack.sqlite --prod ./.tmp/prod-sync.sqlite --output ./.tmp/prod-merged.sqlite
 *
 * Tables synced (analysis domain):
 *   stock, stockMetrics, stockMemory, stockAnalysis, dailySignal, supervisorAlert
 *
 * Tables intentionally skipped:
 *   user, oauthState, watchlist, usageLog
 */

import Database from "better-sqlite3";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/* ── CLI args ─────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const mode = args.includes("--merge") ? "merge" : "diff";
const localPath = getArg("--local") || "./data/stocktrack.sqlite";
const prodPath = getArg("--prod") || "./.tmp/prod-sync.sqlite";
const outputPath = getArg("--output") || prodPath;

function getArg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

if (!existsSync(localPath)) {
  console.error(`Local DB not found: ${localPath}`);
  process.exit(1);
}
if (!existsSync(prodPath)) {
  console.error(`Prod DB not found: ${prodPath}`);
  process.exit(1);
}

/* ── Prepare output DB for merge ──────────────────────────────────────── */

if (mode === "merge") {
  mkdirSync(dirname(outputPath), { recursive: true });
  if (outputPath !== prodPath) {
    copyFileSync(prodPath, outputPath);
  }
}

/* ── Open connection ──────────────────────────────────────────────────── */

let db: Database.Database;
if (mode === "diff") {
  db = new Database(":memory:");
  db.exec(`ATTACH DATABASE '${localPath}' AS local`);
  db.exec(`ATTACH DATABASE '${prodPath}' AS prod`);
} else {
  db = new Database(outputPath);
  db.exec(`ATTACH DATABASE '${localPath}' AS local`);
}
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF"); // we manage order manually

/* ── Diff helpers ─────────────────────────────────────────────────────── */

function diffCount(table: string) {
  const localRow = db.prepare(`SELECT COUNT(*) AS c FROM local.${table}`).get() as { c: number };
  const prodRow = db.prepare(`SELECT COUNT(*) AS c FROM prod.${table}`).get() as { c: number };
  return { local: localRow.c, prod: prodRow.c };
}

function printDiff(table: string, counts: { local: number; prod: number }) {
  const pad = 28;
  console.log(
    `${table.padEnd(pad)} local=${counts.local.toString().padStart(4)}  prod=${counts.prod.toString().padStart(4)}  ` +
      `${counts.local > counts.prod ? `+${counts.local - counts.prod} local` : counts.local < counts.prod ? `+${counts.prod - counts.local} prod` : "=="}`,
  );
}

/* ── Merge helpers ────────────────────────────────────────────────────── */

function run(sql: string, label: string) {
  const stmt = db.prepare(sql);
  const info = stmt.run();
  console.log(`  ${label}: ${info.changes} rows`);
}

/* ═══════════════════════════════════════════════════════════════════════
   DIFF MODE
   ═══════════════════════════════════════════════════════════════════════ */

if (mode === "diff") {
  console.log("\n=== Table row counts ===\n");
  for (const t of ["stock", "stock_metrics", "stock_memory", "stock_analysis", "daily_signal", "supervisor_alert"]) {
    printDiff(t, diffCount(t));
  }

  console.log("\n=== Stocks missing in prod ===\n");
  const missingStocks = db
    .prepare(
      `SELECT s.symbol, s.name
       FROM local.stock s
       LEFT JOIN prod.stock p ON p.symbol = s.symbol
       WHERE p.symbol IS NULL`,
    )
    .all() as { symbol: string; name: string | null }[];
  if (missingStocks.length === 0) {
    console.log("  (none)");
  } else {
    for (const s of missingStocks.slice(0, 20)) {
      console.log(`  ${s.symbol}${s.name ? ` — ${s.name}` : ""}`);
    }
    if (missingStocks.length > 20) {
      console.log(`  ... and ${missingStocks.length - 20} more`);
    }
  }

  console.log("\n=== Analyses missing in prod (by symbol+week) ===\n");
  const missingAnalyses = db
    .prepare(
      `SELECT a.symbol, a.week_start, a.week_end, a.signal
       FROM local.stock_analysis a
       LEFT JOIN prod.stock_analysis p
         ON p.symbol = a.symbol AND p.week_start = a.week_start
       WHERE p.id IS NULL`,
    )
    .all() as { symbol: string; week_start: string; week_end: string; signal: string }[];
  if (missingAnalyses.length === 0) {
    console.log("  (none)");
  } else {
    for (const a of missingAnalyses.slice(0, 20)) {
      console.log(`  ${a.symbol} | ${a.week_start} → ${a.week_end} | ${a.signal}`);
    }
    if (missingAnalyses.length > 20) {
      console.log(`  ... and ${missingAnalyses.length - 20} more`);
    }
  }

  console.log("\n=== Analyses newer in local ===\n");
  const newerAnalyses = db
    .prepare(
      `SELECT a.symbol, a.week_start, a.updated_at AS local_updated, p.updated_at AS prod_updated
       FROM local.stock_analysis a
       JOIN prod.stock_analysis p
         ON p.symbol = a.symbol AND p.week_start = a.week_start
       WHERE a.updated_at > p.updated_at`,
    )
    .all() as { symbol: string; week_start: string; local_updated: number; prod_updated: number }[];
  if (newerAnalyses.length === 0) {
    console.log("  (none)");
  } else {
    for (const a of newerAnalyses.slice(0, 20)) {
      const dLocal = new Date(a.local_updated).toISOString();
      const dProd = new Date(a.prod_updated).toISOString();
      console.log(`  ${a.symbol} | ${a.week_start} | local=${dLocal} > prod=${dProd}`);
    }
    if (newerAnalyses.length > 20) {
      console.log(`  ... and ${newerAnalyses.length - 20} more`);
    }
  }

  console.log("\n=== Daily signals missing in prod ===\n");
  const missingSignals = db
    .prepare(
      `SELECT ds.symbol, ds.date, ds.signal
       FROM local.daily_signal ds
       LEFT JOIN prod.daily_signal pds
         ON pds.stock_analysis_id = ds.stock_analysis_id AND pds.date = ds.date
       WHERE pds.id IS NULL`,
    )
    .all() as { symbol: string; date: string; signal: string }[];
  console.log(`  ${missingSignals.length} signals exist in local without matching prod stock_analysis_id+date`);

  console.log("\n=== Supervisor alerts missing in prod ===\n");
  const missingAlerts = db
    .prepare(
      `SELECT sa.symbol, sa.supervisor, sa.alert_type
       FROM local.supervisor_alert sa
       LEFT JOIN prod.supervisor_alert psa
         ON psa.stock_analysis_id = sa.stock_analysis_id
         AND psa.supervisor = sa.supervisor
         AND psa.alert_type = sa.alert_type
       WHERE psa.id IS NULL`,
    )
    .all() as { symbol: string; supervisor: string; alert_type: string }[];
  console.log(`  ${missingAlerts.length} alerts exist in local without matching prod stock_analysis_id+supervisor+alert_type`);

  console.log("\n");
  db.close();
  process.exit(0);
}

/* ═══════════════════════════════════════════════════════════════════════
   MERGE MODE
   ═══════════════════════════════════════════════════════════════════════ */

console.log(`\nMerging local → prod`);
console.log(`  local : ${localPath}`);
console.log(`  output: ${outputPath}\n`);

const tx = db.transaction(() => {
  /* ── 1. stock ──────────────────────────────────────────────────────── */
  console.log("\n[stock]");
  run(
    `INSERT OR REPLACE INTO stock (symbol, name, exchange, sector, industry, next_check_at, last_analyzed_at, created_at)
     SELECT symbol, name, exchange, sector, industry, next_check_at, last_analyzed_at, created_at
     FROM local.stock`,
    "upserted",
  );

  /* ── 2. stockMetrics ───────────────────────────────────────────────── */
  console.log("\n[stockMetrics]");
  run(
    `INSERT OR REPLACE INTO stock_metrics
     SELECT * FROM local.stock_metrics`,
    "upserted",
  );

  /* ── 3. stockMemory ────────────────────────────────────────────────── */
  console.log("\n[stockMemory]");
  run(
    `INSERT OR REPLACE INTO stock_memory
     SELECT * FROM local.stock_memory`,
    "upserted",
  );

  /* ── 4. stockAnalysis ──────────────────────────────────────────────── */
  console.log("\n[stockAnalysis]");

  // 4a. Insert analyses that don't exist in prod (by symbol+week_start)
  const insertedAnalyses = db.prepare(
    `INSERT INTO stock_analysis (id, symbol, week_start, week_end, signal, cycle, cycle_timeframe, cycle_strength, confidence, reasoning, price_at_analysis, last_triggered_by_user_id, created_at, updated_at)
     SELECT a.id, a.symbol, a.week_start, a.week_end, a.signal, a.cycle, a.cycle_timeframe, a.cycle_strength, a.confidence, a.reasoning, a.price_at_analysis, a.last_triggered_by_user_id, a.created_at, a.updated_at
     FROM local.stock_analysis a
     LEFT JOIN stock_analysis p ON p.symbol = a.symbol AND p.week_start = a.week_start
     WHERE p.id IS NULL`,
  ).run();
  console.log(`  inserted (new): ${insertedAnalyses.changes} rows`);

  // 4b. Update analyses that exist in prod but local is newer
  // We must keep prod.id so child FKs remain valid.
  const updatedAnalyses = db.prepare(
    `UPDATE stock_analysis AS p
     SET week_end            = a.week_end,
         signal              = a.signal,
         cycle               = a.cycle,
         cycle_timeframe     = a.cycle_timeframe,
         cycle_strength      = a.cycle_strength,
         confidence          = a.confidence,
         reasoning           = a.reasoning,
         price_at_analysis   = a.price_at_analysis,
         last_triggered_by_user_id = a.last_triggered_by_user_id,
         updated_at          = a.updated_at
     FROM local.stock_analysis a
     WHERE p.symbol = a.symbol AND p.week_start = a.week_start AND a.updated_at > p.updated_at`,
  ).run();
  console.log(`  updated (local newer): ${updatedAnalyses.changes} rows`);

  // Build a mapping of local analysis id → prod analysis id for rows that share (symbol, week_start)
  // This lets us correctly map child tables (dailySignal, supervisorAlert) even when IDs differ.
  const idMap: Map<string, string> = new Map();
  const rows = db
    .prepare(
      `SELECT a.id AS local_id, p.id AS prod_id
       FROM local.stock_analysis a
       JOIN stock_analysis p ON p.symbol = a.symbol AND p.week_start = a.week_start`,
    )
    .all() as { local_id: string; prod_id: string }[];
  for (const r of rows) {
    idMap.set(r.local_id, r.prod_id);
  }
  console.log(`  id mappings built: ${idMap.size}`);

  /* ── 5. dailySignal ────────────────────────────────────────────────── */
  console.log("\n[dailySignal]");

  // Create a temp table with mapped stock_analysis_ids
  db.exec(`DROP TABLE IF EXISTS _tmp_daily_signal`);
  db.exec(`CREATE TEMP TABLE _tmp_daily_signal AS SELECT * FROM local.daily_signal WHERE 0`);
  const insertTmpDs = db.prepare(`INSERT INTO _tmp_daily_signal (id, stock_analysis_id, symbol, date, signal, cycle, note, price_at_update, signal_changed, trigger, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const localDs = db.prepare(`SELECT * FROM local.daily_signal`).all() as Record<string, unknown>[];
  for (const row of localDs) {
    const mappedId = idMap.get(row.stock_analysis_id as string) || (row.stock_analysis_id as string);
    insertTmpDs.run(
      row.id,
      mappedId,
      row.symbol,
      row.date,
      row.signal,
      row.cycle,
      row.note,
      row.price_at_update,
      row.signal_changed,
      row.trigger,
      row.created_at,
    );
  }

  const insertedSignals = db.prepare(
    `INSERT OR IGNORE INTO daily_signal (id, stock_analysis_id, symbol, date, signal, cycle, note, price_at_update, signal_changed, trigger, created_at)
     SELECT t.id, t.stock_analysis_id, t.symbol, t.date, t.signal, t.cycle, t.note, t.price_at_update, t.signal_changed, t.trigger, t.created_at
     FROM _tmp_daily_signal t
     LEFT JOIN daily_signal p ON p.stock_analysis_id = t.stock_analysis_id AND p.date = t.date
     WHERE p.id IS NULL`,
  ).run();
  console.log(`  inserted (new): ${insertedSignals.changes} rows`);

  const updatedSignals = db.prepare(
    `UPDATE daily_signal AS p
     SET signal         = t.signal,
         cycle          = t.cycle,
         note           = t.note,
         price_at_update= t.price_at_update,
         signal_changed = t.signal_changed,
         trigger        = t.trigger
     FROM _tmp_daily_signal t
     WHERE p.stock_analysis_id = t.stock_analysis_id AND p.date = t.date
       AND t.created_at > p.created_at`,
  ).run();
  console.log(`  updated (local newer): ${updatedSignals.changes} rows`);

  db.exec(`DROP TABLE IF EXISTS _tmp_daily_signal`);

  /* ── 6. supervisorAlert ────────────────────────────────────────────── */
  console.log("\n[supervisorAlert]");

  db.exec(`DROP TABLE IF EXISTS _tmp_supervisor_alert`);
  db.exec(`CREATE TEMP TABLE _tmp_supervisor_alert AS SELECT * FROM local.supervisor_alert WHERE 0`);
  const insertTmpSa = db.prepare(`INSERT INTO _tmp_supervisor_alert (id, symbol, stock_analysis_id, supervisor, alert_type, severity, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const localSa = db.prepare(`SELECT * FROM local.supervisor_alert`).all() as Record<string, unknown>[];
  for (const row of localSa) {
    const mappedId = idMap.get(row.stock_analysis_id as string) || (row.stock_analysis_id as string);
    insertTmpSa.run(
      row.id,
      row.symbol,
      mappedId,
      row.supervisor,
      row.alert_type,
      row.severity,
      row.title,
      row.content,
      row.created_at,
    );
  }

  const insertedAlerts = db.prepare(
    `INSERT OR IGNORE INTO supervisor_alert (id, symbol, stock_analysis_id, supervisor, alert_type, severity, title, content, created_at)
     SELECT t.id, t.symbol, t.stock_analysis_id, t.supervisor, t.alert_type, t.severity, t.title, t.content, t.created_at
     FROM _tmp_supervisor_alert t
     LEFT JOIN supervisor_alert p
       ON p.stock_analysis_id = t.stock_analysis_id
       AND p.supervisor = t.supervisor
       AND p.alert_type = t.alert_type
     WHERE p.id IS NULL`,
  ).run();
  console.log(`  inserted (new): ${insertedAlerts.changes} rows`);

  // For alerts we don't update — they are immutable snapshots, so keep prod's if both exist.

  db.exec(`DROP TABLE IF EXISTS _tmp_supervisor_alert`);
});

tx();

console.log("\n✅ Merge complete.");
if (outputPath !== prodPath) {
  console.log(`   Merged DB written to: ${outputPath}`);
  console.log(`   Push to prod with:  scp ${outputPath} root@mohshoo.tailf9eafe.ts.net:/var/lib/bursa/data/stocktrack.sqlite`);
}
console.log("");

db.close();
