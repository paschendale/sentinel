import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/queries/incident-threads.js', () => ({ getThreadsToReconcile: vi.fn() }))
vi.mock('./incidents.js', () => ({ closeOpenIncidents: vi.fn().mockResolvedValue(undefined) }))

import { getThreadsToReconcile } from '../db/queries/incident-threads.js'
import { closeOpenIncidents } from './incidents.js'
import { RECONCILE_SETTLED_MS, reconcileThreads } from './reconciler.js'

const thread = {
  id: 'th-1', test_id: 't-1', channel_id: 'c-1', state: 'down' as const, provider_root_id: 'r', provider_thread_id: 'r',
  opened_at: new Date(), closed_at: null, last_update_at: new Date(), last_update_message: null, update_count: 1,
  test_name: 'Checkout', last_duration_ms: 87,
}

describe('reconcileThreads', () => {
  beforeEach(() => {
    vi.mocked(getThreadsToReconcile).mockReset()
    vi.mocked(closeOpenIncidents).mockClear()
  })

  it('retries closing threads whose test is operational', async () => {
    vi.mocked(getThreadsToReconcile).mockResolvedValue([thread])
    await expect(reconcileThreads()).resolves.toBe(1)
    expect(getThreadsToReconcile).toHaveBeenCalledWith(RECONCILE_SETTLED_MS)
    const [ctx, threads] = vi.mocked(closeOpenIncidents).mock.calls[0]!
    expect(ctx).toMatchObject({ testId: 't-1', info: { testName: 'Checkout', durationMs: 87 } })
    expect(threads).toEqual([thread])
  })

  it('never throws', async () => {
    vi.mocked(getThreadsToReconcile).mockRejectedValue(new Error('db down'))
    await expect(reconcileThreads()).resolves.toBe(0)
  })
})
