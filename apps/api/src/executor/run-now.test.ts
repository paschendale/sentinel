import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/queries/tests.js', () => ({ getTestById: vi.fn() }))
vi.mock('../db/result-buffer.js', () => ({ enqueue: vi.fn() }))
vi.mock('./run.js', () => ({ runTest: vi.fn() }))

import { getTestById } from '../db/queries/tests.js'
import { enqueue } from '../db/result-buffer.js'
import { releaseRun, tryClaimRun } from '../scheduler/run-guard.js'
import { runNow } from './run-now.js'
import { runTest } from './run.js'

const test = { id: 't-1', enabled: true, code: 'return true', timeout_ms: 1000 } as never
const result = { id: 'r-1', test_id: 't-1', status: 'success' } as never

describe('runNow', () => {
  beforeEach(() => {
    vi.mocked(getTestById).mockReset()
    vi.mocked(runTest).mockReset()
    vi.mocked(enqueue).mockClear()
  })

  it('runs once and records the result', async () => {
    vi.mocked(getTestById).mockResolvedValue(test)
    vi.mocked(runTest).mockResolvedValue(result)
    await expect(runNow('t-1', { trigger: 'api-post' })).resolves.toEqual({ kind: 'ok', result })
    expect(enqueue).toHaveBeenCalledWith(result)
  })

  it('reports unknown and disabled tests', async () => {
    vi.mocked(getTestById).mockResolvedValueOnce(null)
    await expect(runNow('x', { trigger: 'mcp' })).resolves.toEqual({ kind: 'not_found' })
    vi.mocked(getTestById).mockResolvedValueOnce({ ...(test as object), enabled: false } as never)
    await expect(runNow('t-1', { trigger: 'mcp' })).resolves.toEqual({ kind: 'disabled' })
    expect(runTest).not.toHaveBeenCalled()
  })

  it('refuses while a run of the same test is in flight (scheduler or another run-now)', async () => {
    vi.mocked(getTestById).mockResolvedValue(test)
    expect(tryClaimRun('t-1')).toBe(true)
    await expect(runNow('t-1', { trigger: 'api-sse' })).resolves.toEqual({ kind: 'busy' })
    expect(runTest).not.toHaveBeenCalled()
    releaseRun('t-1')
  })

  it('releases the guard even when the run throws', async () => {
    vi.mocked(getTestById).mockResolvedValue(test)
    vi.mocked(runTest).mockRejectedValueOnce(new Error('boom'))
    await expect(runNow('t-1', { trigger: 'api-post' })).rejects.toThrow('boom')
    expect(tryClaimRun('t-1')).toBe(true)
    releaseRun('t-1')
  })
})
