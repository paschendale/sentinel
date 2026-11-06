import type { NotificationChannelType, NotificationEventType } from '@sentinel/shared'

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

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const days = Math.floor(totalSec / 86_400)
  const hours = Math.floor((totalSec % 86_400) / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const TITLES: Record<IncidentState, (name: string) => string> = {
  down: (n) => `🚨 ${n} is DOWN`,
  degraded: (n) => `⚠️ ${n} is DEGRADED`,
  up: (n) => `✅ ${n} is back UP`,
}

const DISCORD_COLORS: Record<IncidentState, number> = { down: 15158332, degraded: 16776960, up: 3066993 }
const SLACK_COLORS: Record<IncidentState, string> = { down: '#e74c3c', degraded: '#f1c40f', up: '#2ecc71' }

interface Field { name: string; value: string; short: boolean }

function fieldsFor(state: IncidentState, info: EventInfo): Field[] {
  const fields: Field[] = []
  if (state === 'up') {
    if (info.downtimeMs !== null) fields.push({ name: 'Downtime', value: formatDuration(info.downtimeMs), short: true })
    fields.push({ name: 'Response Time', value: `${info.durationMs} ms`, short: true })
    return fields
  }
  if (info.errorMessage) fields.push({ name: 'Reason', value: info.errorMessage, short: false })
  if (state === 'down') fields.push({ name: 'Consecutive Failures', value: String(info.consecutiveFailures), short: true })
  fields.push({ name: 'Response Time', value: `${info.durationMs} ms`, short: true })
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
    .map((f) => `<tr><td style="padding:4px 12px 4px 0;color:#71717a">${escapeHtml(f.name)}</td><td style="padding:4px 0">${escapeHtml(f.value)}</td></tr>`)
    .join('')
  const html =
    `<div style="font-family:Consolas,monospace;color:#18181b">` +
    `<h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2>` +
    `<table style="border-collapse:collapse">${rows}</table>` +
    `<p style="color:#71717a;margin-top:16px">Sentinel · ${new Date().toISOString()}</p></div>`
  return { from, to, subject, html }
}

/** One line posted inside an incident thread. */
export function threadReply(state: IncidentState, info: EventInfo, kind: 'update' | 'heartbeat' | 'close'): string {
  if (kind === 'close') {
    const downtime = info.downtimeMs !== null ? ` after ${formatDuration(info.downtimeMs)}` : ''
    return `✅ resolved${downtime} · response ${info.durationMs} ms`
  }
  if (kind === 'heartbeat') {
    const since = info.downtimeMs !== null ? ` for ${formatDuration(info.downtimeMs)}` : ''
    const streak = state === 'down' ? ` · ${info.consecutiveFailures} consecutive failures` : ''
    return `🔁 still ${state}${since}${streak}`
  }
  const reason = info.errorMessage ? ` · ${info.errorMessage}` : ''
  if (state === 'down') return `🚨 down · ${info.consecutiveFailures} consecutive failures${reason}`
  return `⚠️ degraded${reason}`
}

/** Name of the Discord thread opened for an incident (Discord caps names at 100 characters). */
export function threadName(testName: string, openedAt: Date): string {
  const stamp = openedAt.toISOString().slice(0, 16).replace('T', ' ') + 'Z'
  const name = `${testName} · ${stamp}`
  return name.length > 100 ? `${name.slice(0, 99)}…` : name
}

/** A delivery check sent by "send test message"; nothing is in an incident. */
export function testMessage(type: NotificationChannelType): Record<string, unknown> {
  const title = '🔔 Sentinel · channel test'
  const body = 'This channel is wired correctly. Alerts for assigned tests will arrive here.'
  const now = new Date().toISOString()
  switch (type) {
    case 'discord':
    case 'discord_bot':
      return { embeds: [{ title, description: body, color: 6323595, timestamp: now, footer: { text: 'Sentinel' } }] }
    case 'slack':
    case 'slack_bot':
      return { text: title, attachments: [{ color: '#6366f1', title, text: body, footer: 'Sentinel', ts: Math.floor(Date.now() / 1000) }] }
    default:
      return { event: 'test', message: body, timestamp: now }
  }
}
