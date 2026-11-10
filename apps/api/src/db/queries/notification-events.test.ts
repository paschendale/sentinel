import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../pool.js', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }))

import { pool } from '../pool.js'
import { flushNotificationEvents, queueNotificationEvent, queuedNotificationEventCount } from './notification-events.js'

const mockQuery = vi.mocked(pool.query)

const event = (i: number) => ({
  test_id: `t-${i}`,
  channel_id: 'c-1',
  event: 'fail' as const,
  phase: 'sent' as const,
  consecutive_failures: 3,
  failure_threshold: 3,
  cooldown_ms: 0,
  http_status: 200,
})

describe('notification event batching', () => {
  beforeEach(() => {
    mockQuery.mockClear()
  })

  it('writes queued events in multi-row inserts of 100', async () => {
    for (let i = 0; i < 230; i++) queueNotificationEvent(event(i))
    expect(mockQuery).not.toHaveBeenCalled()
    await flushNotificationEvents()
    expect(mockQuery).toHaveBeenCalledTimes(3)
    expect((mockQuery.mock.calls.map((c) => (c[1] as unknown[]).length / 11))).toEqual([100, 100, 30])
    expect(queuedNotificationEventCount()).toBe(0)
  })

  it('does nothing when the queue is empty', async () => {
    await flushNotificationEvents()
    expect(mockQuery).not.toHaveBeenCalled()
  })
})
