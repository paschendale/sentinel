import type { NotificationChannelType, NotificationEventType } from '@sentinel/shared'
import { formatDuration } from '@sentinel/shared'

/** Resend's send-email endpoint, used by email channels. */
export const RESEND_API_URL = 'https://api.resend.com/emails'

export type IncidentState = 'down' | 'degraded' | 'up'

export interface EventInfo {
  testName: string
  consecutiveFailures: number
  errorMessage: string | null
  durationMs: number
  /** How long the test had been down/degraded, when known (recovery, heartbeats). */
  downtimeMs: number | null
}

export function stateForEvent(event: NotificationEventType): IncidentState {
  return event === 'fail' ? 'down' : event === 'warning' ? 'degraded' : 'up'
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Words and colours follow the brand book: state word first, no emoji, colours are the
// `…-solid` state tokens (light theme), and the channel test is neutral.
const TITLES: Record<IncidentState, (name: string) => string> = {
  down: (n) => `Outage: ${n}`,
  degraded: (n) => `Degraded: ${n}`,
  up: (n) => `Recovered: ${n}`,
}

const SOLID_HEX: Record<IncidentState, string> = { down: '#dc2626', degraded: '#d97706', up: '#059669' }
const DISCORD_COLORS: Record<IncidentState, number> = {
  down: parseInt(SOLID_HEX.down.slice(1), 16),
  degraded: parseInt(SOLID_HEX.degraded.slice(1), 16),
  up: parseInt(SOLID_HEX.up.slice(1), 16),
}
const SLACK_COLORS: Record<IncidentState, string> = SOLID_HEX
const NEUTRAL_HEX = '#71717a'

interface Field { name: string; value: string; short: boolean }

function fieldsFor(state: IncidentState, info: EventInfo): Field[] {
  const fields: Field[] = []
  if (state === 'up') {
    if (info.downtimeMs !== null) fields.push({ name: 'Lasted', value: formatDuration(info.downtimeMs), short: true })
    fields.push({ name: 'Response time', value: `${info.durationMs} ms`, short: true })
    return fields
  }
  if (info.errorMessage) fields.push({ name: 'Reason', value: info.errorMessage, short: false })
  if (state === 'down') fields.push({ name: 'Consecutive failures', value: String(info.consecutiveFailures), short: true })
  fields.push({ name: 'Response time', value: `${info.durationMs} ms`, short: true })
  return fields
}

/** Discord embed message (webhook and bot share the shape). */
export function discordMessage(state: IncidentState, info: EventInfo): Record<string, unknown> {
  return {
    embeds: [{
      title: TITLES[state](info.testName),
      color: DISCORD_COLORS[state],
      fields: fieldsFor(state, info).map((f) => ({ name: f.name, value: f.value, inline: f.short })),
      timestamp: new Date().toISOString(),
      footer: { text: 'Sentinel' },
    }],
  }
}

/** Slack attachment message (webhook and bot share the shape; `text` is the notification fallback). */
export function slackMessage(state: IncidentState, info: EventInfo): Record<string, unknown> {
  return {
    text: TITLES[state](info.testName),
    attachments: [{
      color: SLACK_COLORS[state],
      title: TITLES[state](info.testName),
      fields: fieldsFor(state, info).map((f) => ({ title: f.name, value: f.value, short: f.short })),
      footer: 'Sentinel',
      ts: Math.floor(Date.now() / 1000),
    }],
  }
}

/** Generic JSON webhook body. */
export function webhookMessage(event: NotificationEventType, testId: string, info: EventInfo): Record<string, unknown> {
  return {
    test_id: testId,
    test_name: info.testName,
    event,
    consecutive_failures: info.consecutiveFailures,
    error_message: info.errorMessage,
    duration_ms: info.durationMs,
    downtime_ms: info.downtimeMs,
    timestamp: new Date().toISOString(),
  }
}

export function emailMessage(
  event: NotificationEventType,
  info: EventInfo,
  to: string[],
  from: string,
): { from: string; to: string[]; subject: string; html: string } {
  const state = stateForEvent(event)
  const subject = TITLES[state](info.testName)
  const rows = fieldsFor(state, info)
    .map((f) => `<tr><td style="padding:4px 12px 4px 0;color:#6b6b76">${escapeHtml(f.name)}</td><td style="padding:4px 0">${escapeHtml(f.value)}</td></tr>`)
    .join('')
  const html =
    `<div style="font-family:Inconsolata,Consolas,monospace;color:#18181b">` +
    `<h2 style="margin:0 0 12px;color:${SOLID_HEX[state]}">${escapeHtml(subject)}</h2>` +
    `<table style="border-collapse:collapse">${rows}</table>` +
    `<p style="color:#6b6b76;margin-top:16px">Sentinel · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</p></div>`
  return { from, to, subject, html }
}

/** One line posted inside an incident thread. */
export function threadReply(state: IncidentState, info: EventInfo, kind: 'update' | 'heartbeat' | 'close'): string {
  if (kind === 'close') {
    const lasted = info.downtimeMs !== null ? ` after ${formatDuration(info.downtimeMs)}` : ''
    return `Recovered${lasted} · response ${info.durationMs} ms`
  }
  if (kind === 'heartbeat') {
    const since = info.downtimeMs !== null ? ` for ${formatDuration(info.downtimeMs)}` : ''
    const streak = state === 'down' ? ` · ${info.consecutiveFailures} consecutive failures` : ''
    return state === 'down' ? `Still in outage${since}${streak}` : `Still degraded${since}`
  }
  const reason = info.errorMessage ? ` · ${info.errorMessage}` : ''
  if (state === 'down') return `Outage · ${info.consecutiveFailures} consecutive failures${reason}`
  return `Degraded${reason}`
}

/** Name of the Discord thread opened for an incident (Discord caps names at 100 characters). */
export function threadName(testName: string, openedAt: Date): string {
  const stamp = openedAt.toISOString().slice(0, 16).replace('T', ' ') + 'Z'
  const name = `${testName} · ${stamp}`
  return name.length > 100 ? `${name.slice(0, 99)}…` : name
}

export const CHANNEL_TEST_TITLE = 'Sentinel channel test'
export const CHANNEL_TEST_BODY = 'This channel works. Alerts for the tests and tags assigned to it will arrive here.'

/** A delivery check sent by "send test message"; nothing is in an incident. */
export function testMessage(type: NotificationChannelType): Record<string, unknown> {
  const title = CHANNEL_TEST_TITLE
  const body = CHANNEL_TEST_BODY
  const now = new Date().toISOString()
  switch (type) {
    case 'discord':
    case 'discord_bot':
      return { embeds: [{ title, description: body, color: parseInt(NEUTRAL_HEX.slice(1), 16), timestamp: now, footer: { text: 'Sentinel' } }] }
    case 'slack':
    case 'slack_bot':
      return { text: title, attachments: [{ color: NEUTRAL_HEX, title, text: body, footer: 'Sentinel', ts: Math.floor(Date.now() / 1000) }] }
    default:
      return { event: 'test', message: body, timestamp: now }
  }
}
