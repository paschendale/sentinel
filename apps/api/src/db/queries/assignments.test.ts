import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../pool.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}))

import { pool } from '../pool.js'
import { addAssignment, getAssignedChannels, getEffectiveChannelsForTest } from './assignments.js'

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

  it('getEffectiveChannelsForTest merges a channel assigned via both test- and tag-scope into one entry with unioned event_types', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'channel-1', name: 'ops', type: 'webhook', webhook_url: 'https://example.com', email_to: null, enabled: true,
          scope_type: 'test', scope_value: 'test-1', event_types: ['fail'],
        },
        {
          id: 'channel-1', name: 'ops', type: 'webhook', webhook_url: 'https://example.com', email_to: null, enabled: true,
          scope_type: 'tag', scope_value: 'prod', event_types: ['warning'],
        },
        {
          id: 'channel-2', name: 'oncall', type: 'discord', webhook_url: 'https://example.com/2', email_to: null, enabled: false,
          scope_type: 'test', scope_value: 'test-1', event_types: ['recovery'],
        },
      ],
    } as never)

    const result = await getEffectiveChannelsForTest('test-1')

    const ch1 = result.find(c => c.id === 'channel-1')
    expect(ch1?.event_types.sort()).toEqual(['fail', 'warning'])
    expect(ch1?.sources).toHaveLength(2)
    expect(ch1?.sources.map(s => s.scope_type).sort()).toEqual(['tag', 'test'])

    const ch2 = result.find(c => c.id === 'channel-2')
    expect(ch2?.event_types).toEqual(['recovery'])
    expect(ch2?.enabled).toBe(false)
    expect(ch2?.sources).toHaveLength(1)

    const [sql, params] = mockQuery.mock.calls[0] ?? []
    expect(sql).toContain('channel_assignments')
    expect(sql).toContain("ca.scope_type = 'tag'")
    expect(params).toEqual(['test-1'])
  })
})
