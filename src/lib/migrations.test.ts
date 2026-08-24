import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function applyMigration(sqlite: Database.Database, path: string) {
  const migration = readFileSync(path, "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) sqlite.exec(statement);
  }
}

describe("fresh database migrations", () => {
  it("builds a complete empty schema without production data dumps", () => {
    const sqlite = new Database(":memory:");
    try {
      applyMigration(sqlite, "drizzle/20260612104338_soft_argent/migration.sql");
      applyMigration(sqlite, "drizzle/20260824000000_security_state/migration.sql");

      const tables = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toContain("user");
      expect(tables.map((row) => row.name)).toContain("stock");
      expect(tables.map((row) => row.name)).toContain("usage_log");
      expect(sqlite.prepare("SELECT count(*) AS count FROM stock").get()).toEqual({ count: 0 });

      const usageColumns = sqlite.prepare("PRAGMA table_info(usage_log)").all() as Array<{
        name: string;
      }>;
      expect(usageColumns.map((column) => column.name)).toContain("reservation_id");
    } finally {
      sqlite.close();
    }
  });
});
