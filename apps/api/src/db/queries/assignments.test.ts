import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../pool.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}))

import { pool } from '../pool.js'
import { addAssignment, getAssignedChannels } from './assignments.js'

const mockQuery = vi.mocked(pool.query)

describe('assignments queries', () => {
  beforeEach(() => {
    mockQuery.mockClear()
  })

  it('addAssignment upserts event_types on conflict', async () => {
    await addAssignment('channel-1', 'test', 'test-1', ['fail'])

    const [sql, params] = mockQuery.mock.calls[0] ?? []
    expect(sql).toContain('ON CONFLICT (channel_id, scope_type, scope_value)')
    expect(sql).toContain('DO UPDATE SET event_types = excluded.event_types')
    expect(params).toEqual(['channel-1', 'test', 'test-1', ['fail']])
  })

  it('getAssignedChannels selects ca.event_types', async () => {
    await getAssignedChannels('test', 'test-1')

    const [sql, params] = mockQuery.mock.calls[0] ?? []
    expect(sql).toContain('ca.event_types')
    expect(params).toEqual(['test', 'test-1'])
  })
})
