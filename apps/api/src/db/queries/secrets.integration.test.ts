/**
 * Integration tests for the secrets query layer — hits real Postgres.
 *
 * Requires DATABASE_URL pointing to a reachable Postgres instance
 * (reads from .env via global-setup.ts, or set directly in environment).
 * Cleans up rows it creates via a distinctive name prefix; skips gracefully
 * when no reachable database is available.
 *
 * SECRETS_ENCRYPTION_KEY is not set in this test environment (see vitest.config.ts),
 * so encryptSecret/decryptSecret operate in plaintext (mode 0x00) mode here — the
 * AES-256-GCM path itself is covered by crypto/secret-cipher.test.ts. What these
 * tests verify is specific to the DB layer: constraints, no-value-leakage, and the
 * per-row decrypt-failure resilience that a real Postgres round-trip can exercise
 * (a mode-0x01 blob written directly via SQL, which this process can't decrypt).
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import pg from 'pg'
import {
  createSecret,
  rotateSecretValue,
  deleteSecret,
  listSecretsMetadata,
  listAllDecryptedSecrets,
} from './secrets.js'

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
  return `INTEG_SECRET_${Date.now()}_${counter}`
}

beforeAll(async () => {
  await client.connect()
})

afterEach(async () => {
  await client.query(`DELETE FROM secrets WHERE name LIKE 'INTEG\\_SECRET\\_%' ESCAPE '\\'`)
})

afterAll(async () => {
  await client.end()
})

describe.skipIf(!dbAvailable)('secrets query layer integration', () => {
  it('creates a secret and returns metadata with no value field', async () => {
    const name = uniqueName()
    const metadata = await createSecret(`id-${name}`, name, 'sk-hunter2')

    expect(metadata.name).toBe(name)
    expect(metadata.created_at).toBeInstanceOf(Date)
    expect(Object.keys(metadata).sort()).toEqual(['created_at', 'id', 'name', 'updated_at'])
  })

  it('round-trips the value through listAllDecryptedSecrets', async () => {
    const name = uniqueName()
    await createSecret(`id-${name}`, name, 'sk-round-trip')

    const all = await listAllDecryptedSecrets()
    expect(all).toContainEqual({ name, value: 'sk-round-trip' })
  })

  it('listSecretsMetadata never includes the value or value_blob', async () => {
    const name = uniqueName()
    await createSecret(`id-${name}`, name, 'sk-should-not-leak')

    const list = await listSecretsMetadata()
    const row = list.find((s) => s.name === name)
    expect(row).toBeDefined()
    expect(Object.keys(row!)).not.toContain('value')
    expect(Object.keys(row!)).not.toContain('value_blob')
    expect(JSON.stringify(list)).not.toContain('sk-should-not-leak')
  })

  it('rejects a duplicate name with a unique_violation (23505)', async () => {
    const name = uniqueName()
    await createSecret(`id-a-${name}`, name, 'first')

    await expect(createSecret(`id-b-${name}`, name, 'second')).rejects.toMatchObject({
      code: '23505',
    })
  })

  it('rejects an invalid (non-UPPER_SNAKE_CASE) name via the CHECK constraint (23514)', async () => {
    await expect(createSecret('id-lowercase', 'not_upper_case', 'value')).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('rotateSecretValue updates the value and updated_at, keeps created_at, returns null for a missing id', async () => {
    const name = uniqueName()
    const id = `id-${name}`
    const created = await createSecret(id, name, 'original')

    await new Promise((r) => setTimeout(r, 10))
    const rotated = await rotateSecretValue(id, 'rotated-value')

    expect(rotated).not.toBeNull()
    expect(rotated!.created_at).toEqual(created.created_at)
    expect(rotated!.updated_at.getTime()).toBeGreaterThan(created.updated_at.getTime())

    const all = await listAllDecryptedSecrets()
    expect(all).toContainEqual({ name, value: 'rotated-value' })

    expect(await rotateSecretValue('does-not-exist', 'x')).toBeNull()
  })

  it('deleteSecret removes the row and returns false on a second delete', async () => {
    const name = uniqueName()
    const id = `id-${name}`
    await createSecret(id, name, 'to-be-deleted')

    expect(await deleteSecret(id)).toBe(true)
    expect((await listSecretsMetadata()).find((s) => s.name === name)).toBeUndefined()
    expect(await deleteSecret(id)).toBe(false)
  })

  it('listAllDecryptedSecrets skips an undecryptable row instead of throwing, and still returns the rest', async () => {
    const goodName = uniqueName()
    await createSecret(`id-${goodName}`, goodName, 'still-readable')

    // Simulate a secret that was encrypted (mode 0x01) under a key this process no
    // longer has — SECRETS_ENCRYPTION_KEY is unset in this test env, so any mode-0x01
    // blob is undecryptable here. Written directly via SQL since encryptSecret() in
    // this process can only produce mode 0x00 (plaintext) blobs.
    const corruptName = uniqueName()
    await client.query(
      `INSERT INTO secrets (id, name, value_blob) VALUES ($1, $2, $3)`,
      [`id-${corruptName}`, corruptName, Buffer.concat([Buffer.from([0x01]), Buffer.alloc(40, 7)])],
    )

    const all = await listAllDecryptedSecrets()
    expect(all).toContainEqual({ name: goodName, value: 'still-readable' })
    expect(all.find((s) => s.name === corruptName)).toBeUndefined()
  })
})
