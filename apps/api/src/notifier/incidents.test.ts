import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('undici', () => ({
  request: vi.fn(),
}))

vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../db/queries/notification-events.js', () => ({
  queueNotificationEvent: vi.fn(),
  flushNotificationEvents: vi.fn().mockResolvedValue(undefined),
}))

import { request } from 'undici'
import type { IncidentThread } from '@sentinel/shared'
import { pool } from '../db/pool.js'
import { queueNotificationEvent } from '../db/queries/notification-events.js'
import type { DeliverableChannel } from '../db/queries/channels.js'
import { closeOpenIncidents, deliverIncidentEvent, touchOpenIncidents, type IncidentContext } from './incidents.js'

const mockRequest = vi.mocked(request)
const mockQuery = vi.mocked(pool.query)
const mockInsertEvent = vi.mocked(queueNotificationEvent)

function slackOk(extra: Record<string, unknown> = {}) {
  return { statusCode: 200, body: { text: async () => JSON.stringify({ ok: true, ...extra }) } } as never
}

function discordOk(body: Record<string, unknown>) {
  return { statusCode: 200, body: { text: async () => JSON.stringify(body) } } as never
}

function requestBody(callIndex: number): Record<string, unknown> {
  const init = mockRequest.mock.calls[callIndex]?.[1] as { body?: string } | undefined
  return JSON.parse(init?.body ?? '{}') as Record<string, unknown>
}

function requestUrl(callIndex: number): string {
  return String(mockRequest.mock.calls[callIndex]?.[0])
}

const slackChannel: DeliverableChannel = {
  id: 'ch-slack',
  type: 'slack_bot',
  webhook_url: null,
  email_to: null,
  channel_ref: 'C123',
  bot_token: 'xoxb-test',
}

const discordChannel: DeliverableChannel = {
  id: 'ch-discord',
  type: 'discord_bot',
  webhook_url: null,
  email_to: null,
  channel_ref: '999',
  bot_token: 'discord-token',
}

const ctx: IncidentContext = {
  testId: 'test-1',
  consecutiveFailures: 3,
  failureThreshold: 3,
  cooldownMs: 300_000,
  info: { testName: 'API Prod Check', consecutiveFailures: 3, errorMessage: 'network timeout', durationMs: 123, downtimeMs: null },
}

function openThreadRow(overrides: Partial<IncidentThread> = {}): IncidentThread {
  return {
    id: 'thr-1',
    test_id: 'test-1',
    channel_id: 'ch-slack',
    state: 'down',
    provider_root_id: '1700000000.000100',
    provider_thread_id: '1700000000.000100',
    opened_at: new Date(Date.now() - 600_000),
    closed_at: null,
    last_update_at: new Date(),
    last_update_message: 'down|network timeout',
    update_count: 0,
    ...overrides,
  }
}

describe('incident threads on bot channels', () => {
  beforeEach(() => {
    mockRequest.mockReset()
    mockQuery.mockReset()
    mockInsertEvent.mockClear()
  })

  it('opens a Slack incident: posts the root, records the thread row with ts as both handles', async () => {
    mockRequest.mockResolvedValueOnce(slackOk({ ts: '1700000000.000100' }))
    mockQuery.mockResolvedValueOnce({ rows: [openThreadRow()] } as never) // INSERT ... RETURNING

    const result = await deliverIncidentEvent(slackChannel, 'fail', ctx, undefined)

    expect(result.outcome).toBe('opened')
    expect(requestUrl(0)).toMatch(/\/chat\.postMessage$/)
    const body = requestBody(0)
    expect(body['channel']).toBe('C123')
    expect(body['text']).toContain('API Prod Check is DOWN')
    const insert = mockQuery.mock.calls[0]
    expect(insert?.[0]).toContain('INSERT INTO notification_threads')
    expect(insert?.[1]).toEqual(expect.arrayContaining(['test-1', 'ch-slack', 'down', '1700000000.000100', '1700000000.000100']))
    expect(mockInsertEvent.mock.calls.find((c) => c[0].reason === 'thread_opened')).toBeDefined()
  })

  it('opens a Discord incident: posts the root, then creates a thread on that message', async () => {
    mockRequest
      .mockResolvedValueOnce(discordOk({ id: 'msg-1' }))
      .mockResolvedValueOnce(discordOk({ id: 'thread-1' }))
    mockQuery.mockResolvedValueOnce({ rows: [openThreadRow({ channel_id: 'ch-discord', provider_root_id: 'msg-1', provider_thread_id: 'thread-1' })] } as never)

    await deliverIncidentEvent(discordChannel, 'warning', ctx, undefined)

    expect(requestUrl(0)).toMatch(/\/channels\/999\/messages$/)
    expect(requestUrl(1)).toMatch(/\/channels\/999\/messages\/msg-1\/threads$/)
    expect(requestBody(1)['name']).toContain('API Prod Check')
    const insert = mockQuery.mock.calls[0]
    expect(insert?.[1]).toEqual(expect.arrayContaining(['degraded', 'msg-1', 'thread-1']))
  })

  it('updates an open incident instead of posting a new root', async () => {
    mockRequest.mockResolvedValueOnce(slackOk()) // thread reply
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // UPDATE notification_threads

    const result = await deliverIncidentEvent(slackChannel, 'fail', { ...ctx, info: { ...ctx.info, errorMessage: 'HTTP 503' } }, openThreadRow())

    expect(result.outcome).toBe('updated')
    expect(mockRequest).toHaveBeenCalledTimes(1)
    const body = requestBody(0)
    expect(body['thread_ts']).toBe('1700000000.000100')
    expect(String(body['text'])).toContain('HTTP 503')
    expect(mockInsertEvent.mock.calls.find((c) => c[0].reason === 'thread_updated')).toBeDefined()
  })

  it('stays silent when a repeat of the same failure reaches an open incident', async () => {
    const result = await deliverIncidentEvent(slackChannel, 'fail', ctx, openThreadRow())
    expect(result.outcome).toBe('noop')
    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('edits the root when the state changes from down to degraded', async () => {
    mockRequest.mockResolvedValueOnce(slackOk()).mockResolvedValueOnce(slackOk())
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    await deliverIncidentEvent(slackChannel, 'warning', ctx, openThreadRow({ state: 'down' }))

    expect(requestUrl(0)).toMatch(/\/chat\.update$/)
    expect(String(requestBody(0)['text'])).toContain('DEGRADED')
    expect(requestUrl(1)).toMatch(/\/chat\.postMessage$/)
  })

  it('touch: stays silent while nothing changed and the thread is fresh', async () => {
    await touchOpenIncidents('fail', ctx, [openThreadRow()])
    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('touch: replies in the thread when the error message changed', async () => {
    const plaintextToken = Buffer.concat([Buffer.from([0x00]), Buffer.from('xoxb-test', 'utf8')])
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ch-slack', type: 'slack_bot', webhook_url: null, email_to: null, channel_ref: 'C123', bot_token_blob: plaintextToken }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
    mockRequest.mockResolvedValueOnce(slackOk())

    await touchOpenIncidents('fail', { ...ctx, info: { ...ctx.info, errorMessage: 'DNS failure' } }, [openThreadRow()])

    expect(mockRequest).toHaveBeenCalledTimes(1)
    expect(String(requestBody(0)['text'])).toContain('DNS failure')
  })

  it('touch: posts a heartbeat when the last update is older than the heartbeat interval', async () => {
    const plaintextToken = Buffer.concat([Buffer.from([0x00]), Buffer.from('xoxb-test', 'utf8')])
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ch-slack', type: 'slack_bot', webhook_url: null, email_to: null, channel_ref: 'C123', bot_token_blob: plaintextToken }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
    mockRequest.mockResolvedValueOnce(slackOk())

    await touchOpenIncidents('fail', ctx, [openThreadRow({ last_update_at: new Date(Date.now() - 2 * 3_600_000) })])

    expect(String(requestBody(0)['text'])).toContain('still down')
    expect(mockInsertEvent.mock.calls.find((c) => c[0].reason === 'thread_heartbeat')).toBeDefined()
  })

  it('closes a Discord incident: edits the root to UP, posts the closing reply, archives the thread', async () => {
    const plaintextToken = Buffer.concat([Buffer.from([0x00]), Buffer.from('discord-token', 'utf8')])
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ch-discord', type: 'discord_bot', webhook_url: null, email_to: null, channel_ref: '999', bot_token_blob: plaintextToken }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never) // UPDATE closed_at
    mockRequest
      .mockResolvedValueOnce(discordOk({ id: 'msg-1' }))
      .mockResolvedValueOnce(discordOk({ id: 'reply-1' }))
      .mockResolvedValueOnce(discordOk({ id: 'thread-1', archived: true }))

    await closeOpenIncidents(ctx, [openThreadRow({ channel_id: 'ch-discord', provider_root_id: 'msg-1', provider_thread_id: 'thread-1' })])

    expect(requestUrl(0)).toMatch(/\/channels\/999\/messages\/msg-1$/)
    expect((mockRequest.mock.calls[0]?.[1] as { method?: string }).method).toBe('PATCH')
    expect(JSON.stringify(requestBody(0))).toContain('back UP')
    expect(requestUrl(1)).toMatch(/\/channels\/thread-1\/messages$/)
    expect(String(requestBody(1)['content'])).toContain('resolved')
    expect(requestUrl(2)).toMatch(/\/channels\/thread-1$/)
    expect(requestBody(2)['archived']).toBe(true)
    const close = mockQuery.mock.calls[1]
    expect(close?.[0]).toContain('SET closed_at = NOW()')
    expect(mockInsertEvent.mock.calls.find((c) => c[0].reason === 'thread_closed')).toBeDefined()
  })

  it('records a failed event when Slack answers ok:false', async () => {
    mockRequest.mockResolvedValueOnce({ statusCode: 200, body: { text: async () => JSON.stringify({ ok: false, error: 'not_in_channel' }) } } as never)

    await expect(deliverIncidentEvent(slackChannel, 'fail', ctx, undefined)).rejects.toThrow('not_in_channel')
  })
})
