import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../auth/jwt.js', () => ({
  verifyJwt: vi.fn(() => ({ sub: 'mcp' })),
  signJwt: vi.fn(() => 'signed-token'),
}))

import { pool } from '../db/pool.js'
import { verifyJwt } from '../auth/jwt.js'
import { buildServer } from '../server.js'

const mockQuery = vi.mocked(pool.query)
const mockVerify = vi.mocked(verifyJwt)

const MCP_HEADERS = {
  authorization: 'Bearer test-token',
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
}

function rpc(method: string, params?: unknown, id: number | null = 1): Record<string, unknown> {
  return { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }
}

const INITIALIZE = rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'vitest', version: '0' },
})

const EXPECTED_TOOLS = [
  'list_tests',
  'get_test',
  'create_test',
  'update_test',
  'delete_test',
  'run_test_now',
  'get_test_runs',
  'get_test_incidents',
  'get_dashboard_summary',
  'get_status',
  'list_tags',
  'list_channels',
  'create_channel',
  'update_channel',
  'delete_channel',
  'assign_channel',
  'unassign_channel',
  'list_secrets',
  'create_secret',
  'rotate_secret',
  'delete_secret',
]

describe('mcp route', () => {
  beforeEach(() => {
    mockQuery.mockClear()
    mockVerify.mockClear()
    mockVerify.mockReturnValue({ sub: 'mcp' })
  })

  it('rejects unauthenticated requests', async () => {
    mockVerify.mockReturnValue(null)
    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: INITIALIZE,
    })
    expect(res.statusCode).toBe(401)
  })

  it('responds to initialize with server info', async () => {
    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: INITIALIZE,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { result: { serverInfo: { name: string } } }
    expect(body.result.serverInfo.name).toBe('sentinel')
  })

  it('lists all 21 tools', async () => {
    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: rpc('tools/list'),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { result: { tools: Array<{ name: string }> } }
    const names = body.result.tools.map((t) => t.name).sort()
    expect(names).toEqual([...EXPECTED_TOOLS].sort())
  })

  it('round-trips list_tests through the tests route', async () => {
    const row = { id: 't1', name: 'checkout', enabled: true }
    mockQuery.mockResolvedValueOnce({ rows: [row] } as never)

    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: rpc('tools/call', { name: 'list_tests', arguments: {} }),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as {
      result: { content: Array<{ type: string; text: string }>; isError?: boolean }
    }
    expect(body.result.isError).toBeFalsy()
    expect(JSON.parse(body.result.content[0]!.text)).toEqual([row])
  })

  it('marks failed forwards as isError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: rpc('tools/call', { name: 'get_test', arguments: { id: 'missing' } }),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { result: { isError?: boolean } }
    expect(body.result.isError).toBe(true)
  })

  it('returns 405 for GET and DELETE', async () => {
    const app = await buildServer()
    for (const method of ['GET', 'DELETE'] as const) {
      const res = await app.inject({
        method,
        url: '/mcp',
        headers: { authorization: 'Bearer test-token' },
      })
      expect(res.statusCode).toBe(405)
      expect(JSON.parse(res.body).error.code).toBe(-32000)
    }
  })
})
