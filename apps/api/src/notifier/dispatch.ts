import pLimit from 'p-limit'
import { isBotChannelType, isPassing, type IncidentThread, type NotificationChannelType, type PublicStatusOutcome, type TestStatus } from '@sentinel/shared'
import { pool } from '../db/pool.js'
import {
  flushNotificationEvents,
  queueNotificationEvent,
  type NotificationEventInsert,
  type NotificationEventReason,
} from '../db/queries/notification-events.js'
import { CHANNEL_SCOPE_MATCH_SQL } from '../db/queries/assignments.js'
import { decryptBotToken, type DeliverableChannel } from '../db/queries/channels.js'
import { getOpenThreads } from '../db/queries/incident-threads.js'
import { RESEND_API_KEY, RESEND_FROM } from '../config.js'
import { logger } from '../logger.js'
import type { IncidentLink } from '../db/queries/incidents.js'
import { notifyRequest } from './http.js'
import { closeOpenIncidents, deliverIncidentEvent, touchOpenIncidents, type IncidentContext } from './incidents.js'
import {
  discordMessage,
  emailMessage,
  RESEND_API_URL,
  slackMessage,
  stateForEvent,
  webhookMessage,
  type EventInfo,
} from './payloads.js'
import { TransportError } from './transports/types.js'

export interface NotificationCandidate {
  test_id: string
  /** This run's result: picks the event (a pass is a recovery, a warning a warning, else a fail). */
  new_status: TestStatus
  /** The test's state before and after this run: Outage gates fail alerts, the return to Operational is the recovery. */
  prev_public_status: PublicStatusOutcome
  public_status: Exclude<PublicStatusOutcome, 'unknown'>
  error_message: string | null
  duration_ms: number
  /** The stored incident this test belongs to after this run, if any. */
  incident_id?: string | null
  incident_transition?: IncidentLink['transition'] | null
}

const log = logger.child({ component: 'notifier' })

/** Tests evaluated at once; each test's channels are delivered in parallel. */
const TEST_CONCURRENCY = 4

export function triggerNotifications(candidates: NotificationCandidate[]): void {
  runNotifications(candidates).catch((err: unknown) => {
    log.error({ event: 'notifier.unhandled_error', err }, 'notifier: unhandled error')
  })
}

type Event = 'fail' | 'warning' | 'recovery'

export async function runNotifications(candidates: NotificationCandidate[]): Promise<void> {
  for (const c of candidates) incidentOfTest.set(c.test_id, c.incident_id ?? null)
  const actionable = candidates.filter(c => {
    // Warned and failing runs are always evaluated, so a missed Outage can still notify and open
    // bot threads get their updates.
    if (!isPassing(c.new_status)) return true
    // A passing run only matters when it brings the test back to Operational (recovery). With a
    // status window that is the first pass after a full window of passing, not the first pass.
    return c.public_status === 'up' && (c.prev_public_status === 'down' || c.prev_public_status === 'degraded')
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

  // One hung endpoint must not hold back the other tests' alerts.
  const limit = pLimit(TEST_CONCURRENCY)
  try {
    await Promise.all(actionable.map((candidate) => limit(async () => {
      try {
        await evaluateCandidate(candidate, stateMap.get(candidate.test_id), threadsByTest.get(candidate.test_id) ?? [])
      } catch (err) {
        log.error({ event: 'notifier.candidate_failed', test_id: candidate.test_id, err }, `notifier: evaluating test ${candidate.test_id} failed`)
      }
    })))
  } finally {
    await flushNotificationEventsSafe()
  }
}

interface CandidateState {
  test_id: string
  test_name: string
  consecutive_failures: number
  last_notification_at: Date | null
  last_warning_at: Date | null
  failure_threshold: number
  cooldown_ms: number
}

async function evaluateCandidate(
  candidate: NotificationCandidate,
  state: CandidateState | undefined,
  threads: IncidentThread[],
): Promise<void> {
  const consecutive = state?.consecutive_failures ?? 0
  const lastNotifiedAt = state?.last_notification_at ?? null
  const lastWarningAt = state?.last_warning_at ?? null
  const threshold = state?.failure_threshold ?? 3
  const cooldown = state?.cooldown_ms ?? 86_400_000

  const eventType: Event = isPassing(candidate.new_status) ? 'recovery'
    : candidate.new_status === 'warn' ? 'warning'
    : 'fail'

  const ctx: IncidentContext = {
    testId: candidate.test_id,
    incidentId: candidate.incident_id ?? null,
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

  if (eventType === 'warning') {
    // warning: no threshold check; uses last_warning_at for cooldown (independent of fail cooldown)
    if (lastWarningAt !== null && Date.now() - lastWarningAt.getTime() < cooldown) {
      await touchOpenIncidents('warning', ctx, threads)
      return
    }
    await dispatchForTest(ctx, 'warning', null, threads)
  } else if (eventType === 'fail') {
    // fail/timeout: alert only in Outage (the failure threshold, plus the status window when set),
    // then apply the cooldown (last_notification_at only — not affected by warnings)
    if (candidate.public_status !== 'down') {
      await touchOpenIncidents('fail', ctx, threads)
      return
    }
    if (lastNotifiedAt !== null && Date.now() - lastNotifiedAt.getTime() < cooldown) {
      await touchOpenIncidents('fail', ctx, threads)
      return
    }
    await dispatchForTest(ctx, 'fail', null, threads)
  } else {
    // recovery: an open incident is always closed where it was opened, whatever the
    // channel's event filter says; webhook/email channels get a recovery message only
    // if a fail or warning was previously sent.
    await closeOpenIncidents(ctx, threads)
    if (lastNotifiedAt === null && lastWarningAt === null) {
      logSkippedEvent(candidate.test_id, 'recovery', consecutive, threshold, cooldown, 'no_prior_notification')
      return
    }
    const downtimeFrom = lastNotifiedAt ?? lastWarningAt
    await dispatchForTest(ctx, 'recovery', downtimeFrom, [])
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
    logSkippedEvent(testId, event, consecutiveFailures, failureThreshold, cooldownMs, 'no_channels')
    return
  }

  await Promise.all(rows.map((row) => deliverToChannel(row, ctx, event, info, openThreads)))
}

async function deliverToChannel(
  row: ChannelRow,
  ctx: IncidentContext,
  event: Event,
  info: EventInfo,
  openThreads: IncidentThread[],
): Promise<void> {
  const { testId, consecutiveFailures, failureThreshold, cooldownMs } = ctx
  // A bot channel is closed by closeOpenIncidents() on recovery; nothing else to send.
  if (event === 'recovery' && isBotChannelType(row.type)) return

  try {
    if (isBotChannelType(row.type)) {
      if (event === 'recovery') return // closed above by closeOpenIncidents()
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
      return
    }

    const statusCode = await sendOneShot(row, event, testId, info)
    if (statusCode < 200 || statusCode >= 300) {
      logNotificationEvent({
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
      return
    }

    logNotificationEvent({
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
    logNotificationEvent({
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
    log.warn({ event: 'notifier.delivery_failed', test_id: testId, channel_id: row.id, channel_type: row.type, err: message }, `notifier: failed to deliver ${event} to ${row.type} channel ${row.id} for test ${testId}`)
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
    const response = await notifyRequest(RESEND_API_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${RESEND_API_KEY}` },
      body: emailMessage(event, info, channel.email_to ?? [], RESEND_FROM),
    })
    return response.statusCode
  }
  const state = stateForEvent(event)
  const body = channel.type === 'discord'
    ? discordMessage(state, info)
    : channel.type === 'slack'
      ? slackMessage(state, info)
      : webhookMessage(event, testId, info)
  if (!channel.webhook_url) throw new TransportError('channel has no webhook_url')
  const response = await notifyRequest(channel.webhook_url, { method: 'POST', body })
  return response.statusCode
}

function logSkippedEvent(
  testId: string,
  event: Event,
  consecutiveFailures: number,
  threshold: number,
  cooldownMs: number,
  reason: NotificationEventReason,
): void {
  logNotificationEvent({
    test_id: testId,
    event,
    phase: 'skipped',
    reason,
    consecutive_failures: consecutiveFailures,
    failure_threshold: threshold,
    cooldown_ms: cooldownMs,
  })
}

function logNotificationEvent(input: NotificationEventInsert): void {
  queueNotificationEvent({ incident_id: incidentOfTest.get(input.test_id) ?? null, ...input })
}

/** Incident id of the test currently being notified, for its audit rows. */
const incidentOfTest = new Map<string, string | null>()

/** Writes the queued audit rows. Never throws: the audit log must not break alerting. */
export async function flushNotificationEventsSafe(): Promise<void> {
  try {
    await flushNotificationEvents()
  } catch (err: unknown) {
    log.error({ event: 'notifier.event_log_failed', err }, 'notifier: failed to write notification events')
  }
}
