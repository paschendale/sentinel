import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/pool.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('../auth/jwt.js', () => ({ verifyJwt: vi.fn(() => ({ sub: 'admin' })) }))

import { pool } from '../db/pool.js'
import { buildServer } from '../server.js'

const mockQuery = vi.mocked(pool.query)
const auth = { authorization: 'Bearer t' }

describe('one error shape', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('answers a validation failure with a readable string and the field breakdown in details', async () => {
    const app = await buildServer()
    const res = await app.inject({ method: 'POST', url: '/tests', headers: auth, payload: { name: '' } })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { error: unknown; details?: { fieldErrors?: Record<string, unknown> } }
    expect(typeof body.error).toBe('string')
    expect(body.error).toMatch(/^name: /)
    expect(body.details?.fieldErrors).toHaveProperty('code')
  })

  it('answers malformed JSON with 400 and a string error', async () => {
    const app = await buildServer()
    const res = await app.inject({ method: 'POST', url: '/tests', headers: { ...auth, 'content-type': 'application/json' }, payload: '{"name":' })
    expect(res.statusCode).toBe(400)
    expect(typeof (res.json() as { error: unknown }).error).toBe('string')
  })

  it('hides internals of an unexpected error behind a 500', async () => {
    mockQuery.mockRejectedValue(new Error('relation "secret_table" does not exist'))
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/tests', headers: auth })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'internal error' })
  })

  it('answers an unknown route with 404', async () => {
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/nope', headers: auth })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })
})
