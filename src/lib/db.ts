import * as schema from './schema'

let _db: Awaited<ReturnType<typeof buildDb>> | null = null

function resolveDbPath() {
  const raw =
    process.env.DB_PATH ||
    process.env.DATABASE_URL ||
    './data/stocktrack.sqlite'

  return raw.startsWith('file:') ? raw.slice('file:'.length) : raw
}

async function buildDb() {
  const [{ default: Database }, { drizzle }, fs, path] = await Promise.all([
    import('better-sqlite3'),
    import('drizzle-orm/better-sqlite3'),
    import('node:fs/promises'),
    import('node:path'),
  ])

  const dbPath = resolveDbPath()
  await fs.mkdir(path.dirname(dbPath), { recursive: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sqlite = new (Database as any)(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  return drizzle(sqlite, { schema })
}

export async function getDb() {
  if (!_db) _db = await buildDb()
  return _db
}

export function getDbPath() {
  return resolveDbPath()
}
