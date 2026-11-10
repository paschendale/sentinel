import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('undici', () => ({
  request: vi.fn().mockResolvedValue({ statusCode: 200 }),
}))

vi.mock('../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../db/queries/notification-events.js', () => ({
  insertNotificationEvent: vi.fn().mockResolvedValue(undefined),
}))

import { pool } from '../db/pool.js'
import { request } from 'undici'
import { insertNotificationEvent } from '../db/queries/notification-events.js'
import { triggerNotifications } from './dispatch.js'

const mockQuery = vi.mocked(pool.query)
const mockRequest = vi.mocked(request)
const mockInsertNotificationEvent = vi.mocked(insertNotificationEvent)

describe('triggerNotifications', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockRequest.mockClear()
    mockInsertNotificationEvent.mockClear()
  })

  it('uses normalized tag matching in dispatch query', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          test_id: 'test-1',
          consecutive_failures: 3,
          last_notification_at: null,
          failure_threshold: 3,
          cooldown_ms: 300000,
        }],
      } as never)
      // open incident threads lookup (none)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    triggerNotifications([{
      test_id: 'test-1',
      new_status: 'fail',
      prev_status: 'success',
      error_message: 'network timeout',
      duration_ms: 123,
    }])

    await new Promise(resolve => setTimeout(resolve, 0))

    const dispatchCall = mockQuery.mock.calls.find((call) => {
      const sql = call[0]
      return typeof sql === 'string' && sql.includes('SELECT DISTINCT nc.id, nc.type')
    })
    const dispatchSql = dispatchCall?.[0]
    expect(dispatchSql).toContain('LOWER(BTRIM(ca.scope_value))')
    expect(dispatchSql).toContain('SELECT LOWER(BTRIM(tag_value))')
    expect(dispatchSql).toContain('$2 = ANY(ca.event_types)')
    expect(dispatchCall?.[1]).toEqual(['test-1', 'fail'])
  })

  it('passes the resolved event type as a query param when filtering channels for warning', async () => {
    // warning path: state lookup, update last_warning_at, channel lookup
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          test_id: 'test-1',
          consecutive_failures: 0,
          last_notification_at: null,
          last_warning_at: null,
          failure_threshold: 3,
          cooldown_ms: 300000,
        }],
      } as never)
      // open incident threads lookup (none)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    triggerNotifications([{
      test_id: 'test-1',
      new_status: 'warn',
      prev_status: 'success',
      error_message: 'slow response',
      duration_ms: 500,
    }])
    await new Promise(resolve => setTimeout(resolve, 0))

    const dispatchCall = mockQuery.mock.calls.find((call) => {
      const sql = call[0]
      return typeof sql === 'string' && sql.includes('SELECT DISTINCT nc.id, nc.type')
    })
    expect(dispatchCall?.[1]).toEqual(['test-1', 'warning'])
  })

  it('dispatches both fail and recovery events for tag-assigned channel', async () => {
    mockQuery
      // fail path: state lookup, update last_notification_at, channel lookup
      .mockResolvedValueOnce({
        rows: [{
          test_id: 'test-1',
          consecutive_failures: 3,
          last_notification_at: null,
          failure_threshold: 3,
          cooldown_ms: 300000,
        }],
      } as never)
      // open incident threads lookup (none)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{ id: 'ch-1', type: 'webhook', webhook_url: 'https://example.com/webhook', test_name: 'API Prod Check' }],
      } as never)
      // recovery path: state lookup, update last_notification_at, channel lookup
      .mockResolvedValueOnce({
        rows: [{
          test_id: 'test-1',
          consecutive_failures: 0,
          last_notification_at: new Date('2026-03-26T00:00:00.000Z'),
          failure_threshold: 3,
          cooldown_ms: 300000,
        }],
      } as never)
      // open incident threads lookup (none)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{ id: 'ch-1', type: 'webhook', webhook_url: 'https://example.com/webhook', test_name: 'API Prod Check' }],
      } as never)

    triggerNotifications([{
      test_id: 'test-1',
      new_status: 'fail',
      prev_status: 'success',
      error_message: 'network timeout',
      duration_ms: 321,
    }])
    await new Promise(resolve => setTimeout(resolve, 0))

    triggerNotifications([{
      test_id: 'test-1',
      new_status: 'success',
      prev_status: 'fail',
      error_message: null,
      duration_ms: 101,
    }])
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mockRequest).toHaveBeenCalledTimes(2)
    expect(mockRequest.mock.calls[0]?.[0]).toBe('https://example.com/webhook')
    expect(mockRequest.mock.calls[1]?.[0]).toBe('https://example.com/webhook')
  })

  it('logs skipped event when below threshold', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        test_id: 'test-1',
        consecutive_failures: 1,
        last_notification_at: null,
        failure_threshold: 3,
        cooldown_ms: 300000,
      }],
    } as never)
      // open incident threads lookup (none)
      .mockResolvedValueOnce({ rows: [] } as never)

    triggerNotifications([{
      test_id: 'test-1',
      new_status: 'fail',
      prev_status: 'success',
      error_message: 'network timeout',
      duration_ms: 123,
    }])

    await new Promise(resolve => setTimeout(resolve, 0))

    const skipped = mockInsertNotificationEvent.mock.calls.find(c => c[0].phase === 'skipped')
    expect(skipped?.[0].reason).toBe('below_threshold')
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('logs skipped event when cooldown is active', async () => {
    const now = Date.now()
    mockQuery.mockResolvedValueOnce({
      rows: [{
        test_id: 'test-1',
        consecutive_failures: 3,
        last_notification_at: new Date(now - 1000),
        failure_threshold: 3,
        cooldown_ms: 300000,
      }],
    } as never)
      // open incident threads lookup (none)
      .mockResolvedValueOnce({ rows: [] } as never)

    triggerNotifications([{
      test_id: 'test-1',
      new_status: 'fail',
      prev_status: 'success',
      error_message: 'network timeout',
      duration_ms: 123,
    }])

    await new Promise(resolve => setTimeout(resolve, 0))

    const skipped = mockInsertNotificationEvent.mock.calls.find(c => c[0].phase === 'skipped')
    expect(skipped?.[0].reason).toBe('cooldown_active')
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('logs skipped event when no channels match', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          test_id: 'test-1',
          consecutive_failures: 3,
          last_notification_at: null,
          failure_threshold: 3,
          cooldown_ms: 300000,
        }],
      } as never)
      // open incident threads lookup (none)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    triggerNotifications([{
      test_id: 'test-1',
      new_status: 'fail',
      prev_status: 'success',
      error_message: 'network timeout',
      duration_ms: 123,
    }])

    await new Promise(resolve => setTimeout(resolve, 0))

    const skipped = mockInsertNotificationEvent.mock.calls.find(c => c[0].phase === 'skipped' && c[0].reason === 'no_channels')
    expect(skipped).toBeDefined()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('logs failed event on non-2xx webhook response', async () => {
    mockRequest.mockResolvedValueOnce({ statusCode: 500 } as never)
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          test_id: 'test-1',
          consecutive_failures: 3,
          last_notification_at: null,
          failure_threshold: 3,
          cooldown_ms: 300000,
        }],
      } as never)
      // open incident threads lookup (none)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{ id: 'ch-1', type: 'webhook', webhook_url: 'https://example.com/webhook', test_name: 'API Prod Check' }],
      } as never)

    triggerNotifications([{
      test_id: 'test-1',
      new_status: 'fail',
      prev_status: 'success',
      error_message: 'network timeout',
      duration_ms: 123,
    }])

    await new Promise(resolve => setTimeout(resolve, 0))

    const attempted = mockInsertNotificationEvent.mock.calls.find(c => c[0].phase === 'attempted')
    const failed = mockInsertNotificationEvent.mock.calls.find(c => c[0].phase === 'failed' && c[0].reason === 'http_non_2xx')
    expect(attempted).toBeDefined()
    expect(failed?.[0].http_status).toBe(500)
  })

  it('logs failed event on transport exception', async () => {
    mockRequest.mockRejectedValueOnce(new Error('socket hang up'))
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          test_id: 'test-1',
          consecutive_failures: 3,
          last_notification_at: null,
          failure_threshold: 3,
          cooldown_ms: 300000,
        }],
      } as never)
      // open incident threads lookup (none)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{ id: 'ch-1', type: 'webhook', webhook_url: 'https://example.com/webhook', test_name: 'API Prod Check' }],
      } as never)

    triggerNotifications([{
      test_id: 'test-1',
      new_status: 'fail',
      prev_status: 'success',
      error_message: 'network timeout',
      duration_ms: 123,
    }])

    await new Promise(resolve => setTimeout(resolve, 0))

    const failed = mockInsertNotificationEvent.mock.calls.find(c => c[0].phase === 'failed' && c[0].reason === 'http_error')
    expect(failed?.[0].error_message).toContain('socket hang up')
  })

  it('notifies on ongoing fail streak when threshold is now met', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          test_id: 'test-1',
          consecutive_failures: 3,
          last_notification_at: null,
          failure_threshold: 3,
          cooldown_ms: 300000,
        }],
      } as never)
      // open incident threads lookup (none)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{ id: 'ch-1', type: 'webhook', webhook_url: 'https://example.com/webhook', test_name: 'API Prod Check' }],
      } as never)

    triggerNotifications([{
      test_id: 'test-1',
      new_status: 'fail',
      prev_status: 'fail',
      error_message: 'still down',
      duration_ms: 123,
    }])

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mockRequest).toHaveBeenCalledTimes(1)
    const sent = mockInsertNotificationEvent.mock.calls.find(c => c[0].phase === 'sent')
    expect(sent).toBeDefined()
  })
})

describe('parallel delivery', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockRequest.mockReset()
  })

  it('does not hold back other tests behind one hung webhook', async () => {
    const state = (id: string) => ({ test_id: id, test_name: id, consecutive_failures: 3, last_notification_at: null, last_warning_at: null, failure_threshold: 3, cooldown_ms: 0 })
    mockQuery.mockImplementation(((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM test_state ts')) return Promise.resolve({ rows: [state('slow'), state('fast')] })
      if (sql.includes('SELECT DISTINCT nc.id')) {
        const url = params?.[0] === 'slow' ? 'https://slow.example.com' : 'https://fast.example.com'
        return Promise.resolve({ rows: [{ id: `ch-${String(params?.[0])}`, type: 'webhook', webhook_url: url, email_to: null, channel_ref: null, bot_token_blob: null }] })
      }
      return Promise.resolve({ rows: [] })
    }) as never)
    const delivered: string[] = []
    mockRequest.mockImplementation(((url: string) => {
      if (url.includes('slow')) return new Promise(() => {}) // never answers
      delivered.push(url)
      return Promise.resolve({ statusCode: 200 })
    }) as never)

    triggerNotifications([
      { test_id: 'slow', new_status: 'fail', prev_status: 'success', error_message: 'x', duration_ms: 1 },
      { test_id: 'fast', new_status: 'fail', prev_status: 'success', error_message: 'y', duration_ms: 1 },
    ])
    await vi.waitFor(() => expect(delivered).toEqual(['https://fast.example.com']))
  })
})
