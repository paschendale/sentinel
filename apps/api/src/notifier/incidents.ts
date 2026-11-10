import type { IncidentThread, IncidentThreadState, NotificationEventType } from '@sentinel/shared'
import { INCIDENT_THREAD_HEARTBEAT_MS } from '../config.js'
import { getDeliverableChannel, type DeliverableChannel } from '../db/queries/channels.js'
import { closeThread, openThread, recordThreadUpdate } from '../db/queries/incident-threads.js'
import { queueNotificationEvent, type NotificationEventReason } from '../db/queries/notification-events.js'
import { logger } from '../logger.js'
import {
  discordMessage,
  slackMessage,
  threadName,
  threadReply,
  type EventInfo,
  type IncidentState,
} from './payloads.js'
import { discordBotTransport } from './transports/discord-bot.js'
import { slackBotTransport } from './transports/slack-bot.js'
import { TransportError, type BotCredentials, type IncidentHandles, type IncidentTransport } from './transports/types.js'

/**
 * Incident threads for bot-backed channels.
 *
 * A webhook channel gets one message per event. A bot channel gets one message per
 * incident: the root is posted when the incident opens, edited whenever the state
 * changes, and edited to "back UP" when it ends; everything in between goes into the
 * thread under it. One open thread exists per (test, channel); it is the row in
 * `notification_threads` with `closed_at IS NULL`.
 */

export interface IncidentContext {
  testId: string
  info: EventInfo
  consecutiveFailures: number
  failureThreshold: number
  cooldownMs: number
}

export interface BotDelivery {
  outcome: 'opened' | 'updated' | 'closed' | 'noop'
}

function transportFor(type: DeliverableChannel['type']): IncidentTransport {
  return type === 'slack_bot' ? slackBotTransport : discordBotTransport
}

function rootMessage(type: DeliverableChannel['type'], state: IncidentState, info: EventInfo): Record<string, unknown> {
  return type === 'slack_bot' ? slackMessage(state, info) : discordMessage(state, info)
}

function credentialsOf(channel: DeliverableChannel): BotCredentials {
  if (channel.bot_token === null || channel.channel_ref === null) {
    throw new TransportError('bot channel has no token or channel id configured')
  }
  return { token: channel.bot_token, channelRef: channel.channel_ref }
}

function handlesOf(thread: IncidentThread): IncidentHandles {
  return { rootId: thread.provider_root_id, threadId: thread.provider_thread_id }
}

function dedupeKey(state: IncidentThreadState, info: EventInfo): string {
  return `${state}|${info.errorMessage ?? ''}`
}

async function logEvent(
  ctx: IncidentContext,
  channelId: string,
  event: NotificationEventType,
  phase: 'sent' | 'failed',
  reason: NotificationEventReason,
  errorMessage?: string,
  httpStatus?: number | null,
): Promise<void> {
  try {
    queueNotificationEvent({
      test_id: ctx.testId,
      channel_id: channelId,
      event,
      phase,
      reason,
      consecutive_failures: ctx.consecutiveFailures,
      failure_threshold: ctx.failureThreshold,
      cooldown_ms: ctx.cooldownMs,
      ...(httpStatus !== undefined ? { http_status: httpStatus } : {}),
      ...(errorMessage !== undefined ? { error_message: errorMessage.slice(0, 2000) } : {}),
    })
  } catch (err) {
    logger.error({ event: 'notifier.event_log_failed', err }, 'notifier: failed to write notification event')
  }
}

/**
 * Delivers a fail or warning event to a bot channel: opens the incident if none is open,
 * otherwise updates the open one. Throws TransportError on provider failure so the caller
 * records it like any other channel failure.
 */
export async function deliverIncidentEvent(
  channel: DeliverableChannel,
  event: 'fail' | 'warning',
  ctx: IncidentContext,
  open: IncidentThread | undefined,
): Promise<BotDelivery> {
  const state: IncidentThreadState = event === 'fail' ? 'down' : 'degraded'
  if (open !== undefined) {
    // Same rule as touchOpenIncidents: a reply only when something changed or the thread
    // went quiet for a heartbeat interval; a repeat of the same failure stays silent.
    const changed = open.state !== state || open.last_update_message !== dedupeKey(state, ctx.info)
    const stale = Date.now() - new Date(open.last_update_at).getTime() >= INCIDENT_THREAD_HEARTBEAT_MS
    if (!changed && !stale) return { outcome: 'noop' }
    await updateIncident(channel, open, state, ctx, changed ? 'update' : 'heartbeat')
    return { outcome: 'updated' }
  }
  const transport = transportFor(channel.type)
  const creds = credentialsOf(channel)
  const openedAt = new Date()
  const handles = await transport.open(creds, rootMessage(channel.type, state, ctx.info), threadName(ctx.info.testName, openedAt))
  await openThread({
    test_id: ctx.testId,
    channel_id: channel.id,
    state,
    provider_root_id: handles.rootId,
    provider_thread_id: handles.threadId,
    message: dedupeKey(state, ctx.info),
  })
  await logEvent(ctx, channel.id, event, 'sent', 'thread_opened')
  return { outcome: 'opened' }
}

/**
 * Feeds an evaluation into an already-open incident thread. Called for every fail or
 * warning evaluation of a test that has open threads, including the ones the regular
 * threshold/cooldown gating skips: the channel stays quiet, the thread keeps the history.
 * A reply is posted when the state or the error message changed, or when the last update
 * is older than INCIDENT_THREAD_HEARTBEAT_MS. Never throws.
 */
export async function touchOpenIncidents(
  event: 'fail' | 'warning',
  ctx: IncidentContext,
  threads: IncidentThread[],
): Promise<void> {
  const state: IncidentThreadState = event === 'fail' ? 'down' : 'degraded'
  for (const thread of threads) {
    try {
      const changed = thread.state !== state || thread.last_update_message !== dedupeKey(state, ctx.info)
      const stale = Date.now() - new Date(thread.last_update_at).getTime() >= INCIDENT_THREAD_HEARTBEAT_MS
      if (!changed && !stale) continue
      const channel = await getDeliverableChannel(thread.channel_id)
      if (channel === null) continue
      await updateIncident(channel, thread, state, ctx, changed ? 'update' : 'heartbeat')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await logEvent(ctx, thread.channel_id, event, 'failed', 'thread_update_failed', message, err instanceof TransportError ? err.httpStatus : null)
    }
  }
}

async function updateIncident(
  channel: DeliverableChannel,
  thread: IncidentThread,
  state: IncidentThreadState,
  ctx: IncidentContext,
  kind: 'update' | 'heartbeat',
): Promise<void> {
  const transport = transportFor(channel.type)
  const creds = credentialsOf(channel)
  const handles = handlesOf(thread)
  const info: EventInfo = { ...ctx.info, downtimeMs: Date.now() - new Date(thread.opened_at).getTime() }
  if (thread.state !== state) {
    await transport.updateRoot(creds, handles, rootMessage(channel.type, state, ctx.info))
  }
  await transport.reply(creds, handles, threadReply(state, info, kind))
  await recordThreadUpdate(thread.id, state, dedupeKey(state, ctx.info))
  await logEvent(ctx, channel.id, state === 'down' ? 'fail' : 'warning', 'sent', kind === 'heartbeat' ? 'thread_heartbeat' : 'thread_updated')
}

/**
 * Ends every open incident of a test: edits each root to "back UP", posts the closing
 * reply and archives the thread. Runs on recovery regardless of the channel's event-type
 * filter, because an open incident must always be closed where it was opened. Never throws.
 */
export async function closeOpenIncidents(ctx: IncidentContext, threads: IncidentThread[]): Promise<void> {
  for (const thread of threads) {
    try {
      const channel = await getDeliverableChannel(thread.channel_id)
      if (channel === null) {
        await closeThread(thread.id)
        continue
      }
      const transport = transportFor(channel.type)
      const creds = credentialsOf(channel)
      const handles = handlesOf(thread)
      const info: EventInfo = { ...ctx.info, downtimeMs: Date.now() - new Date(thread.opened_at).getTime() }
      await transport.updateRoot(creds, handles, rootMessage(channel.type, 'up', info))
      await transport.reply(creds, handles, threadReply('up', info, 'close'))
      await transport.close(creds, handles)
      await closeThread(thread.id)
      await logEvent(ctx, channel.id, 'recovery', 'sent', 'thread_closed')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await logEvent(ctx, thread.channel_id, 'recovery', 'failed', 'thread_update_failed', message, err instanceof TransportError ? err.httpStatus : null)
    }
  }
}

/** Posts a one-off message through a bot channel (delivery test). Throws TransportError. */
export async function postStandalone(channel: DeliverableChannel, message: Record<string, unknown>): Promise<void> {
  await transportFor(channel.type).post(credentialsOf(channel), message)
}

