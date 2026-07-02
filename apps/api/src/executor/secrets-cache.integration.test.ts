/**
 * Integration tests for the secrets in-memory cache — hits real Postgres.
 *
 * Requires DATABASE_URL pointing to a reachable Postgres instance (reads from
 * .env via global-setup.ts, or set directly in environment). Skips gracefully
 * when no reachable database is available.
 *
 * Exercises the exact path run.ts relies on: warmSecretsCache() reading real
 * (decrypted) rows from Postgres into a snapshot that buildCtx exposes as
 * ctx.secrets, plus the resilience fix (one undecryptable row must not stop
 * the cache from warming with everything else).
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import pg from 'pg'
import { createSecret, deleteSecret } from '../db/queries/secrets.js'
import { warmSecretsCache, getSecretsSnapshot } from './secrets-cache.js'
import { buildCtx } from './ctx.js'

const DATABASE_URL = process.env['DATABASE_URL']

async function checkDbAvailable(): Promise<boolean> {
  if (!DATABASE_URL) return false
  const probe = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 })
  try {
    await probe.connect()
    await probe.end()
    return true
  } catch {
    return false
  }
}

const dbAvailable = await checkDbAvailable()

const client = new pg.Client({ connectionString: DATABASE_URL! })

let counter = 0
function uniqueName(): string {
  counter += 1
  return `INTEG_CACHE_${Date.now()}_${counter}`
}

beforeAll(async () => {
  await client.connect()
})

afterEach(async () => {
  await client.query(`DELETE FROM secrets WHERE name LIKE 'INTEG\\_CACHE\\_%' ESCAPE '\\'`)
  // Reset the module-level cache so tests don't leak state into each other.
  await warmSecretsCache()
})

afterAll(async () => {
  await client.end()
})

describe.skipIf(!dbAvailable)('secrets cache integration', () => {
  it('warms the snapshot from real Postgres and exposes it as ctx.secrets', async () => {
    const name = uniqueName()
    const id = `id-${name}`
    await createSecret(id, name, 'warm-value')

    await warmSecretsCache()
    const snapshot = getSecretsSnapshot()
    expect(snapshot[name]).toBe('warm-value')

    const { ctx } = buildCtx({ secrets: snapshot })
    expect(ctx.secrets[name]).toBe('warm-value')

    await deleteSecret(id)
  })

  it('reflects a write-through refresh without needing a process restart', async () => {
    const name = uniqueName()
    const id = `id-${name}`

    await warmSecretsCache()
    expect(getSecretsSnapshot()[name]).toBeUndefined()

    await createSecret(id, name, 'added-later')
    await warmSecretsCache()
    expect(getSecretsSnapshot()[name]).toBe('added-later')

    await deleteSecret(id)
    await warmSecretsCache()
    expect(getSecretsSnapshot()[name]).toBeUndefined()
  })

  it('returns a frozen snapshot object', async () => {
    await warmSecretsCache()
    expect(Object.isFrozen(getSecretsSnapshot())).toBe(true)
  })

  it('warms successfully even with one undecryptable row present, excluding only that key', async () => {
    const goodName = uniqueName()
    await createSecret(`id-${goodName}`, goodName, 'readable')

    const corruptName = uniqueName()
    await client.query(
      `INSERT INTO secrets (id, name, value_blob) VALUES ($1, $2, $3)`,
      [`id-${corruptName}`, corruptName, Buffer.concat([Buffer.from([0x01]), Buffer.alloc(40, 3)])],
    )

    await expect(warmSecretsCache()).resolves.toBeUndefined()
    const snapshot = getSecretsSnapshot()
    expect(snapshot[goodName]).toBe('readable')
    expect(snapshot[corruptName]).toBeUndefined()

    const { ctx } = buildCtx({ secrets: snapshot })
    expect(ctx.secrets[corruptName]).toBeUndefined()
  })
})
