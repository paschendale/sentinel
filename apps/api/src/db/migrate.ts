/**
 * Migration runner.
 * Usage: pnpm --filter @sentinel/api migrate
 *
 * Reads *.sql files from ./migrations/ in alphabetical order.
 * Tracks applied migrations in the schema_migrations table.
 * Each migration runs inside a transaction — failure rolls back and stops.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { DATABASE_URL } from '../config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, 'migrations')

/**
 * Retries the initial connection with backoff. On a host reboot, Docker restarts
 * `unless-stopped` containers in no particular order — this process can easily win
 * the race against the database container. Without a retry here, that race is fatal:
 * this is the first thing index.ts awaits at startup, so a single failed connection
 * attempt crashes the whole process before it ever binds a port.
 */
async function connectWithRetry(
  pool: pg.Pool,
  { maxAttempts = 10, baseDelayMs = 1000, maxDelayMs = 15000 } = {}
): Promise<pg.PoolClient> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await pool.connect()
    } catch (err) {
      if (attempt >= maxAttempts) throw err
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)
      console.error(
        `db: connection attempt ${attempt}/${maxAttempts} failed (${(err as Error).message}), retrying in ${delayMs}ms`
      )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

async function run(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 })
  const client = await connectWithRetry(pool)

  try {
    // Ensure the bookkeeping table exists before querying it.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // Load already-applied migration filenames.
    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations ORDER BY filename'
    )
    const applied = new Set(rows.map((r) => r.filename))

    // Collect and sort migration files.
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort()

    let ranCount = 0

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`skip  ${filename}`)
        continue
      }

      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8')

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        )
        await client.query('COMMIT')
        console.log(`apply ${filename}`)
        ranCount++
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration failed: ${filename}\n${(err as Error).message}`)
      }
    }

    if (ranCount === 0) {
      console.log('No new migrations to apply.')
    } else {
      console.log(`Done. Applied ${ranCount} migration(s).`)
    }
  } finally {
    client.release()
    await pool.end()
  }
}

export { run as migrate }

// Auto-run when executed directly (pnpm migrate)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
