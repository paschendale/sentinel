import type { ProblemWindow, StatusSection } from './sections.js'

export type TestStatus = 'success' | 'warn' | 'fail' | 'timeout'
export type NotificationChannelType = 'discord' | 'slack' | 'webhook' | 'email' | 'discord_bot' | 'slack_bot'

/** Channel types that post through a bot token and keep one thread per incident. */
export const BOT_CHANNEL_TYPES: readonly NotificationChannelType[] = ['discord_bot', 'slack_bot']

export function isBotChannelType(type: NotificationChannelType): type is 'discord_bot' | 'slack_bot' {
  return type === 'discord_bot' || type === 'slack_bot'
}

/** Lifecycle state of a bot channel's incident thread. */
export type IncidentThreadState = 'down' | 'degraded'
export type NotificationEventType = 'fail' | 'recovery' | 'warning'

export interface Test {
  id: string
  name: string
  code: string
  schedule_ms: number
  timeout_ms: number
  retries: number
  uses_browser: boolean
  enabled: boolean
  failure_threshold: number
  cooldown_ms: number
  tags: string[]
  created_at: Date
  updated_at: Date
}

export interface TestRun {
  id: string
  test_id: string
  started_at: Date
  finished_at: Date
  status: TestStatus
  duration_ms: number
  error_message: string | null
}

export interface AssertionResult {
  id: string
  test_run_id: string
  name: string
  passed: boolean
  message: string | null
}

export interface UptimeDaily {
  test_id: string
  date: string // YYYY-MM-DD
  success_count: number
  /** Runs that passed with a warning. Neither a success nor a failure. */
  warn_count: number
  failure_count: number
  avg_latency_ms: number
}

export interface NotificationChannel {
  id: string
  name: string
  type: NotificationChannelType
  webhook_url: string | null
  email_to: string[] | null
  /** Slack channel ID (C…) or Discord channel ID a bot channel posts into. */
  channel_ref: string | null
  /** Whether a bot token is stored. The token itself is write-only. */
  has_bot_token: boolean
  enabled: boolean
}

/** One incident as tracked on a bot channel: the provider message/thread Sentinel keeps editing. */
export interface IncidentThread {
  id: string
  test_id: string
  channel_id: string
  state: IncidentThreadState
  provider_root_id: string
  provider_thread_id: string
  opened_at: Date
  closed_at: Date | null
  last_update_at: Date
  last_update_message: string | null
  update_count: number
}

/** A NotificationChannel as returned alongside a specific assignment — includes that assignment's event-type filter. */
export interface AssignedChannel extends NotificationChannel {
  event_types: NotificationEventType[]
}

/** One channel_assignments row backing an effective channel — where the routing came from. */
export interface EffectiveChannelSource {
  scope_type: 'test' | 'tag'
  scope_value: string
  event_types: NotificationEventType[]
}

/**
 * A channel actually wired to notify a test, once test-scoped and tag-inherited
 * assignments are merged. `event_types` is the union across every matching source —
 * this is what the notifier will actually fire, not just what's assigned directly.
 */
export interface EffectiveChannelAssignment extends NotificationChannel {
  event_types: NotificationEventType[]
  sources: EffectiveChannelSource[]
}

/** Metadata only — the value is write-only and never returned by any API response. */
export interface Secret {
  id: string
  name: string
  created_at: Date
  updated_at: Date
}

export interface ChannelAssignment {
  channel_id: string
  scope_type: 'test' | 'tag'
  scope_value: string
  event_types: NotificationEventType[]
}

export interface TestSummary extends ProblemWindow {
  id: string
  name: string
  enabled: boolean
  tags: string[]
  last_status: TestStatus | null
  last_run_at: string | null
  pass_rate_7d: number | null
  avg_latency_ms: number | null
  public_status: PublicStatusOutcome
  consecutive_failures: number
  failure_threshold: number
  /** Where the test is listed; see statusSection(). */
  section: StatusSection
}

export interface Incident {
  started_at: string
  ended_at: string
  duration_ms: number
  failure_count: number
  ongoing: boolean
}

/** Public /status page — derived from `uptime_daily` only (no raw runs). */
export type PublicStatusOutcome = 'up' | 'degraded' | 'down' | 'unknown'

/** Granular status history — time period for bucket queries. */
export type StatusPeriod = '1h' | '24h' | '7d' | '30d'

export interface StatusBucket {
  bucket_start: string // ISO timestamp
  bucket_end: string   // ISO timestamp
  success_count: number
  /** Runs that passed with a warning (status `warn`). Not counted in failure_count. */
  warn_count: number
  /** Failed and timed-out runs. */
  failure_count: number
  avg_latency_ms: number | null
}

export interface StatusBucketTest {
  id: string
  name: string
  enabled: boolean
  tags: string[]
  buckets: StatusBucket[]
}

export interface PublicStatusDay {
  date: string
  outcome: PublicStatusOutcome
}

export interface PublicStatusTest extends ProblemWindow {
  id: string
  name: string
  enabled: boolean
  tags: string[]
  current_status: PublicStatusOutcome
  uptime_pct_30d: number | null
  days: PublicStatusDay[]
  /** Where the test is listed; see statusSection(). */
  section: StatusSection
}

/** A single check's outcome, shown on the public status page (mirrors the admin run history). */
export interface PublicStatusEvent {
  id: string
  started_at: string
  finished_at: string
  status: TestStatus
  duration_ms: number
  error_message: string | null
  assertions: Array<{ name: string; passed: boolean; message: string | null }>
}
