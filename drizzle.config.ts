import { defineConfig } from "drizzle-kit";

const raw = process.env.DB_PATH || process.env.DATABASE_URL || "./data/stocktrack.sqlite";
const url = raw.startsWith("file:") ? raw.slice("file:".length) : raw;

export default defineConfig({
  out: "./drizzle",
  schema: "./src/lib/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url,
  },
});
