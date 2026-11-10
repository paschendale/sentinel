import { request } from 'undici'
import { isBotChannelType, isPassing, type IncidentThread, type NotificationChannelType, type TestStatus } from '@sentinel/shared'
import { pool } from '../db/pool.js'
import {
  insertNotificationEvent,
  type NotificationEventReason,
} from '../db/queries/notification-events.js'
import { CHANNEL_SCOPE_MATCH_SQL } from '../db/queries/assignments.js'
import { decryptBotToken, type DeliverableChannel } from '../db/queries/channels.js'
import { getOpenThreads } from '../db/queries/incident-threads.js'
import { RESEND_API_KEY, RESEND_FROM } from '../config.js'
import { withSentinelHeaders } from '../outbound-headers.js'
import { closeOpenIncidents, deliverIncidentEvent, touchOpenIncidents, type IncidentContext } from './incidents.js'
import {
  discordMessage,
  emailMessage,
  slackMessage,
  stateForEvent,
  webhookMessage,
  type EventInfo,
} from './payloads.js'
import { TransportError } from './transports/types.js'

export interface NotificationCandidate {
  test_id: string
  new_status: TestStatus
  prev_status: TestStatus | null
  error_message: string | null
  duration_ms: number
}

export function triggerNotifications(candidates: NotificationCandidate[]): void {
  runNotifications(candidates).catch((err: unknown) => {
    console.error('notifier: unhandled error', err)
  })
}

type Event = 'fail' | 'warning' | 'recovery'

async function runNotifications(candidates: NotificationCandidate[]): Promise<void> {
  const actionable = candidates.filter(c => {
    // Warned and failing runs are always evaluated, so a missed threshold crossing can still notify.
    if (!isPassing(c.new_status)) return true
    // A passing run only matters right after a run that did not pass (recovery).
    return c.prev_status !== null && !isPassing(c.prev_status)
  })
  if (actionable.length === 0) return

  const testIds = actionable.map(c => c.test_id)
  const stateResult = await pool.query<{
    test_id: string
    test_name: string
    consecutive_failures: number
    last_notification_at: Date | null
    last_warning_at: Date | null
    failure_threshold: number
    cooldown_ms: number
  }>(
    `SELECT ts.test_id, t.name AS test_name, ts.consecutive_failures, ts.last_notification_at,
            ts.last_warning_at, t.failure_threshold, t.cooldown_ms
     FROM test_state ts
     JOIN tests t ON t.id = ts.test_id
     WHERE ts.test_id = ANY($1)`,
    [testIds],
  )
  const stateMap = new Map(stateResult.rows.map(r => [r.test_id, r]))

  // Open incident threads on bot channels keep receiving updates even when the regular
  // threshold/cooldown gating below decides not to alert again.
  const openThreads = await getOpenThreads(testIds)
  const threadsByTest = new Map<string, IncidentThread[]>()
  for (const thread of openThreads) {
    const list = threadsByTest.get(thread.test_id) ?? []
    list.push(thread)
    threadsByTest.set(thread.test_id, list)
  }

  for (const candidate of actionable) {
    const state = stateMap.get(candidate.test_id)
    const consecutive = state?.consecutive_failures ?? 0
    const lastNotifiedAt = state?.last_notification_at ?? null
    const lastWarningAt = state?.last_warning_at ?? null
    const threshold = state?.failure_threshold ?? 3
    const cooldown = state?.cooldown_ms ?? 86_400_000
    const threads = threadsByTest.get(candidate.test_id) ?? []

    const eventType: Event = isPassing(candidate.new_status) ? 'recovery'
      : candidate.new_status === 'warn' ? 'warning'
      : 'fail'

    const ctx: IncidentContext = {
      testId: candidate.test_id,
      consecutiveFailures: consecutive,
      failureThreshold: threshold,
      cooldownMs: cooldown,
      info: {
        testName: state?.test_name ?? candidate.test_id,
        consecutiveFailures: consecutive,
        errorMessage: candidate.error_message,
        durationMs: candidate.duration_ms,
        downtimeMs: null,
      },
    }

    await logNotificationEventSafe({
      test_id: candidate.test_id,
      event: eventType,
      phase: 'evaluated',
      consecutive_failures: consecutive,
      failure_threshold: threshold,
      cooldown_ms: cooldown,
    })

    if (eventType === 'warning') {
      // warning: no threshold check; uses last_warning_at for cooldown (independent of fail cooldown)
      if (lastWarningAt !== null && Date.now() - lastWarningAt.getTime() < cooldown) {
        await logSkippedEvent(candidate.test_id, 'warning', consecutive, threshold, cooldown, 'cooldown_active')
        await touchOpenIncidents('warning', ctx, threads)
        continue
      }
      await dispatchForTest(ctx, 'warning', null, threads)
    } else if (eventType === 'fail') {
      // fail/timeout: check per-test threshold and cooldown (last_notification_at only — not affected by warnings)
      if (consecutive < threshold) {
        await logSkippedEvent(candidate.test_id, 'fail', consecutive, threshold, cooldown, 'below_threshold')
        await touchOpenIncidents('fail', ctx, threads)
        continue
      }
      if (lastNotifiedAt !== null && Date.now() - lastNotifiedAt.getTime() < cooldown) {
        await logSkippedEvent(candidate.test_id, 'fail', consecutive, threshold, cooldown, 'cooldown_active')
        await touchOpenIncidents('fail', ctx, threads)
        continue
      }
      await dispatchForTest(ctx, 'fail', null, threads)
    } else {
      // recovery: an open incident is always closed where it was opened, whatever the
      // channel's event filter says; webhook/email channels get a recovery message only
      // if a fail or warning was previously sent.
      await closeOpenIncidents(ctx, threads)
      if (lastNotifiedAt === null && lastWarningAt === null) {
        await logSkippedEvent(candidate.test_id, 'recovery', consecutive, threshold, cooldown, 'no_prior_notification')
        continue
      }
      const downtimeFrom = lastNotifiedAt ?? lastWarningAt
      await dispatchForTest(ctx, 'recovery', downtimeFrom, [])
    }
  }
}

interface ChannelRow {
  id: string
  type: NotificationChannelType
  webhook_url: string | null
  email_to: string[] | null
  channel_ref: string | null
  bot_token_blob: Buffer | null
}

async function dispatchForTest(
  ctx: IncidentContext,
  event: Event,
  lastNotifiedAt: Date | null,
  openThreads: IncidentThread[],
): Promise<void> {
  const { testId, consecutiveFailures, failureThreshold, cooldownMs } = ctx
  // Update the appropriate timestamp first to prevent duplicate dispatches.
  // fail/recovery use last_notification_at; warnings use last_warning_at (separate cooldown).
  if (event === 'fail') {
    await pool.query(`UPDATE test_state SET last_notification_at = NOW() WHERE test_id = $1`, [testId])
  } else if (event === 'warning') {
    await pool.query(`UPDATE test_state SET last_warning_at = NOW() WHERE test_id = $1`, [testId])
  } else {
    // recovery: clear both so the next incident starts fresh
    await pool.query(
      `UPDATE test_state SET last_notification_at = NULL, last_warning_at = NULL WHERE test_id = $1`,
      [testId],
    )
  }

  const channelResult = await pool.query<ChannelRow>(
    `SELECT DISTINCT nc.id, nc.type, nc.webhook_url, nc.email_to, nc.channel_ref, nc.bot_token_blob
     FROM notification_channels nc
     JOIN tests t ON t.id = $1
     WHERE nc.enabled = TRUE
       AND nc.id IN (
         SELECT ca.channel_id FROM channel_assignments ca
         WHERE $2 = ANY(ca.event_types)
           AND (${CHANNEL_SCOPE_MATCH_SQL})
       )`,
    [testId, event],
  )

  const downtimeMs = lastNotifiedAt !== null ? Date.now() - lastNotifiedAt.getTime() : null
  const info: EventInfo = { ...ctx.info, downtimeMs }
  const rows = channelResult.rows ?? []

  // Bot channels with an open incident that this event's filter does not route to still
  // get the update in their thread.
  const routed = new Set(rows.map(r => r.id))
  if (event !== 'recovery') {
    const unrouted = openThreads.filter(t => !routed.has(t.channel_id))
    if (unrouted.length > 0) await touchOpenIncidents(event, ctx, unrouted)
  }

  if (rows.length === 0) {
    await logSkippedEvent(testId, event, consecutiveFailures, failureThreshold, cooldownMs, 'no_channels')
    return
  }

  for (const row of rows) {
    // A bot channel is closed by closeOpenIncidents() on recovery; nothing else to send.
    if (event === 'recovery' && isBotChannelType(row.type)) continue

    await logNotificationEventSafe({
      test_id: testId,
      channel_id: row.id,
      event,
      phase: 'attempted',
      consecutive_failures: consecutiveFailures,
      failure_threshold: failureThreshold,
      cooldown_ms: cooldownMs,
    })

    try {
      if (isBotChannelType(row.type)) {
        if (event === 'recovery') continue // closed above by closeOpenIncidents()
        const channel: DeliverableChannel = {
          id: row.id,
          type: row.type,
          webhook_url: row.webhook_url,
          email_to: row.email_to,
          channel_ref: row.channel_ref,
          bot_token: decryptBotToken(row.bot_token_blob ?? null, row.id),
        }
        const open = openThreads.find(t => t.channel_id === row.id)
        await deliverIncidentEvent(channel, event, ctx, open)
        continue
      }

      const statusCode = await sendOneShot(row, event, testId, info)
      if (statusCode < 200 || statusCode >= 300) {
        await logNotificationEventSafe({
          test_id: testId,
          channel_id: row.id,
          event,
          phase: 'failed',
          reason: 'http_non_2xx',
          consecutive_failures: consecutiveFailures,
          failure_threshold: failureThreshold,
          cooldown_ms: cooldownMs,
          http_status: statusCode,
          error_message: `non-2xx status: ${statusCode}`,
        })
        continue
      }

      await logNotificationEventSafe({
        test_id: testId,
        channel_id: row.id,
        event,
        phase: 'sent',
        consecutive_failures: consecutiveFailures,
        failure_threshold: failureThreshold,
        cooldown_ms: cooldownMs,
        http_status: statusCode,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await logNotificationEventSafe({
        test_id: testId,
        channel_id: row.id,
        event,
        phase: 'failed',
        reason: 'http_error',
        consecutive_failures: consecutiveFailures,
        failure_threshold: failureThreshold,
        cooldown_ms: cooldownMs,
        http_status: err instanceof TransportError ? err.httpStatus : null,
        error_message: message.slice(0, 2000),
      })
      console.error(`notifier: failed to dispatch to ${row.type} for test ${testId}`, err)
    }
  }
}

/** One message per event: webhook-style channels and email. Returns the HTTP status. */
export async function sendOneShot(
  channel: Pick<DeliverableChannel, 'type' | 'webhook_url' | 'email_to'>,
  event: Event,
  testId: string,
  info: EventInfo,
): Promise<number> {
  if (channel.type === 'email') {
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured')
    const response = await request('https://api.resend.com/emails', {
      method: 'POST',
      headers: withSentinelHeaders({
        'content-type': 'application/json',
        'authorization': `Bearer ${RESEND_API_KEY}`,
      }),
      body: JSON.stringify(emailMessage(event, info, channel.email_to ?? [], RESEND_FROM)),
    })
    return response.statusCode
  }
  const state = stateForEvent(event)
  const body = channel.type === 'discord'
    ? discordMessage(state, info)
    : channel.type === 'slack'
      ? slackMessage(state, info)
      : webhookMessage(event, testId, info)
  const response = await request(channel.webhook_url!, {
    method: 'POST',
    headers: withSentinelHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  })
  return response.statusCode
}

async function logSkippedEvent(
  testId: string,
  event: Event,
  consecutiveFailures: number,
  threshold: number,
  cooldownMs: number,
  reason: NotificationEventReason,
): Promise<void> {
  await logNotificationEventSafe({
    test_id: testId,
    event,
    phase: 'skipped',
    reason,
    consecutive_failures: consecutiveFailures,
    failure_threshold: threshold,
    cooldown_ms: cooldownMs,
  })
}

async function logNotificationEventSafe(
  input: Parameters<typeof insertNotificationEvent>[0],
): Promise<void> {
  try {
    await insertNotificationEvent(input)
  } catch (err: unknown) {
    console.error('notifier: failed to write notification event', err)
  }
}
