import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientQuery = vi.fn()
vi.mock('../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
  },
}))
vi.mock('../auth/jwt.js', () => ({ verifyJwt: vi.fn(() => ({ sub: 'admin' })) }))
vi.mock('../executor/run-now.js', () => ({ runNow: vi.fn().mockResolvedValue({ kind: 'ok' }), RUN_NOW_ERRORS: {} }))

import { pool } from '../db/pool.js'
import { testEvents } from '../events.js'
import { runNow } from '../executor/run-now.js'
import { buildServer } from '../server.js'

const auth = { authorization: 'Bearer t' }
const mockQuery = vi.mocked(pool.query)

function test(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, enabled: true, tags: [] as string[], ...extra }
}

/** The tests that exist, as the transaction sees them. */
let db: Array<ReturnType<typeof test>> = []

beforeEach(() => {
  db = [test('a'), test('b', { tags: ['api'] }), test('off', { enabled: false })]
  clientQuery.mockReset()
  clientQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    const ids = (params?.[0] as string[] | undefined) ?? []
    if (sql.startsWith('SELECT * FROM tests WHERE id = ANY')) return { rows: db.filter((t) => ids.includes(t.id)) }
    if (sql.startsWith('UPDATE tests SET enabled')) return { rows: db.filter((t) => ids.includes(t.id)).map((t) => ({ ...t, enabled: params?.[1] })) }
    if (sql.startsWith('UPDATE tests SET tags = array_append')) return { rows: db.filter((t) => ids.includes(t.id) && !t.tags.includes(String(params?.[1]))) }
    if (sql.startsWith('DELETE FROM tests')) return { rows: db.filter((t) => ids.includes(t.id)).map((t) => ({ id: t.id })) }
    return { rows: [] }
  })
  mockQuery.mockReset()
  mockQuery.mockImplementation((async (sql: string, params?: unknown[]) => {
    const ids = (params?.[0] as string[] | undefined) ?? []
    if (sql.startsWith('SELECT * FROM tests WHERE id = ANY')) return { rows: db.filter((t) => ids.includes(t.id)) }
    return { rows: [] }
  }) as never)
  vi.mocked(runNow).mockClear()
})

async function bulk(payload: unknown) {
  const app = await buildServer()
  return app.inject({ method: 'POST', url: '/tests/bulk', headers: auth, payload: payload as Record<string, unknown> })
}

describe('POST /tests/bulk', () => {
  it('disables many tests in one transaction and reports each id', async () => {
    const updated: string[] = []
    const onUpdated = (t: { id: string }) => updated.push(t.id)
    testEvents.on('test:updated', onUpdated)
    const res = await bulk({ ids: ['a', 'b', 'missing'], action: 'disable' })
    testEvents.off('test:updated', onUpdated)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      action: 'disable',
      results: [{ id: 'a', ok: true }, { id: 'b', ok: true }, { id: 'missing', ok: false, error: 'not found' }],
    })
    const sqls = clientQuery.mock.calls.map((c) => String(c[0]))
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls.at(-1)).toBe('COMMIT')
    expect(sqls.filter((q) => q.startsWith('UPDATE tests SET enabled'))).toHaveLength(1)
    expect(updated).toEqual(['a', 'b'])
  })

  it('rolls back when a write fails', async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT')) return { rows: db }
      if (sql.startsWith('DELETE FROM tests')) throw new Error('boom')
      return { rows: [] }
    })
    const res = await bulk({ ids: ['a', 'b'], action: 'delete' })
    expect(res.statusCode).toBe(500)
    expect(clientQuery.mock.calls.map((c) => String(c[0]))).toContain('ROLLBACK')
  })

  it('deletes tests and their test-scoped channel assignments', async () => {
    const res = await bulk({ ids: ['a'], action: 'delete' })
    expect(res.json()).toEqual({ action: 'delete', results: [{ id: 'a', ok: true }] })
    expect(clientQuery.mock.calls.some((c) => String(c[0]).includes('DELETE FROM channel_assignments'))).toBe(true)
  })

  it('adds a normalized tag and refuses a test that already has 20', async () => {
    db.push(test('full', { tags: Array.from({ length: 20 }, (_, i) => `t${i}`) }))
    const res = await bulk({ ids: ['a', 'full'], action: 'add_tag', tag: '  Billing ' })
    expect(res.json()).toEqual({
      action: 'add_tag',
      results: [{ id: 'a', ok: true }, { id: 'full', ok: false, error: 'a test has at most 20 tags' }],
    })
    const append = clientQuery.mock.calls.find((c) => String(c[0]).startsWith('UPDATE tests SET tags = array_append'))!
    expect(append[1]).toEqual([['a'], 'billing'])
  })

  it('requires a tag for add_tag and remove_tag', async () => {
    const res = await bulk({ ids: ['a'], action: 'remove_tag' })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toBe('tag: tag is required for remove_tag')
  })

  it('rejects an unknown action and an empty id list', async () => {
    expect((await bulk({ ids: ['a'], action: 'explode' })).statusCode).toBe(400)
    expect((await bulk({ ids: [], action: 'enable' })).statusCode).toBe(400)
  })

  it('starts runs of enabled tests and reports the others', async () => {
    const res = await bulk({ ids: ['a', 'off', 'missing'], action: 'run' })
    expect(res.json()).toEqual({
      action: 'run',
      results: [
        { id: 'a', ok: true, started: true },
        { id: 'off', ok: false, error: 'test is disabled' },
        { id: 'missing', ok: false, error: 'not found' },
      ],
    })
    expect(runNow).toHaveBeenCalledTimes(1)
    expect(runNow).toHaveBeenCalledWith('a', { trigger: 'api-post' })
  })
})
