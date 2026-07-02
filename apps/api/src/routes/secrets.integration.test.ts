/**
 * Integration tests for the secrets HTTP routes — hits real Postgres via the
 * app's real pool (only auth is mocked, matching the pattern in tags.test.ts).
 *
 * Requires DATABASE_URL pointing to a reachable Postgres instance (reads from
 * .env via global-setup.ts, or set directly in environment). Skips gracefully
 * when no reachable database is available.
 */
import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest'
import pg from 'pg'

vi.mock('../auth/jwt.js', () => ({
  verifyJwt: vi.fn(() => true),
}))

import { buildServer } from '../server.js'
import { listAllDecryptedSecrets } from '../db/queries/secrets.js'

const DATABASE_URL = process.env['DATABASE_URL']
const AUTH_HEADERS = { authorization: 'Bearer test-token' }

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
  return `INTEG_ROUTE_${Date.now()}_${counter}`
}

beforeAll(async () => {
  await client.connect()
})

afterEach(async () => {
  await client.query(`DELETE FROM secrets WHERE name LIKE 'INTEG\\_ROUTE\\_%' ESCAPE '\\'`)
})

afterAll(async () => {
  await client.end()
})

describe.skipIf(!dbAvailable)('secrets routes integration', () => {
  it('rejects requests with no auth', async () => {
    const app = await buildServer()
    // No Authorization header at all — the auth hook 401s before ever calling
    // verifyJwt (see server.ts's `if (!raw || !verifyJwt(raw))` short-circuit),
    // so the shared module-level mock is untouched and stays "authenticated"
    // for every other test in this file.
    const res = await app.inject({ method: 'GET', url: '/secrets' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects requests with an invalid token', async () => {
    const app = await buildServer()
    vi.mocked((await import('../auth/jwt.js')).verifyJwt).mockReturnValueOnce(null)
    const res = await app.inject({ method: 'GET', url: '/secrets', headers: AUTH_HEADERS })
    expect(res.statusCode).toBe(401)
  })

  it('creates a secret via POST and never returns the value', async () => {
    const app = await buildServer()
    const name = uniqueName()
    const res = await app.inject({
      method: 'POST',
      url: '/secrets',
      headers: AUTH_HEADERS,
      payload: { name, value: 'sk-http-test' },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['name']).toBe(name)
    expect(Object.keys(body)).not.toContain('value')
    expect(res.body).not.toContain('sk-http-test')
  })

  it('rejects an invalid create body with 400', async () => {
    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/secrets',
      headers: AUTH_HEADERS,
      payload: { name: 'not_upper_case', value: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a duplicate name with 409', async () => {
    const app = await buildServer()
    const name = uniqueName()
    await app.inject({ method: 'POST', url: '/secrets', headers: AUTH_HEADERS, payload: { name, value: 'first' } })

    const res = await app.inject({
      method: 'POST',
      url: '/secrets',
      headers: AUTH_HEADERS,
      payload: { name, value: 'second' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('lists secrets without ever exposing a value in the response body', async () => {
    const app = await buildServer()
    const name = uniqueName()
    await app.inject({
      method: 'POST',
      url: '/secrets',
      headers: AUTH_HEADERS,
      payload: { name, value: 'super-secret-value' },
    })

    const res = await app.inject({ method: 'GET', url: '/secrets', headers: AUTH_HEADERS })
    expect(res.statusCode).toBe(200)
    const list = JSON.parse(res.body) as Array<Record<string, unknown>>
    expect(list.some((s) => s['name'] === name)).toBe(true)
    expect(res.body).not.toContain('super-secret-value')
  })

  it('GET /secrets/status reflects isEncryptionConfigured()', async () => {
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/secrets/status', headers: AUTH_HEADERS })
    expect(res.statusCode).toBe(200)
    // SECRETS_ENCRYPTION_KEY is unset in the test environment (vitest.config.ts).
    expect(JSON.parse(res.body)).toEqual({ encryptionEnabled: false })
  })

  it('rotates a value via POST /secrets/:id/rotate, persisting the new value', async () => {
    const app = await buildServer()
    const name = uniqueName()
    const createRes = await app.inject({
      method: 'POST',
      url: '/secrets',
      headers: AUTH_HEADERS,
      payload: { name, value: 'original' },
    })
    const { id } = JSON.parse(createRes.body) as { id: string }

    const rotateRes = await app.inject({
      method: 'POST',
      url: `/secrets/${id}/rotate`,
      headers: AUTH_HEADERS,
      payload: { value: 'rotated' },
    })
    expect(rotateRes.statusCode).toBe(200)
    expect(rotateRes.body).not.toContain('rotated')

    const all = await listAllDecryptedSecrets()
    expect(all).toContainEqual({ name, value: 'rotated' })
  })

  it('returns 404 rotating a missing secret', async () => {
    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/secrets/does-not-exist/rotate',
      headers: AUTH_HEADERS,
      payload: { value: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('deletes a secret via DELETE and 404s on a repeat delete', async () => {
    const app = await buildServer()
    const name = uniqueName()
    const createRes = await app.inject({
      method: 'POST',
      url: '/secrets',
      headers: AUTH_HEADERS,
      payload: { name, value: 'to-delete' },
    })
    const { id } = JSON.parse(createRes.body) as { id: string }

    const deleteRes = await app.inject({ method: 'DELETE', url: `/secrets/${id}`, headers: AUTH_HEADERS })
    expect(deleteRes.statusCode).toBe(204)

    const secondDelete = await app.inject({ method: 'DELETE', url: `/secrets/${id}`, headers: AUTH_HEADERS })
    expect(secondDelete.statusCode).toBe(404)
  })
})
