export type TestStatus = 'success' | 'warn' | 'fail' | 'timeout'
export type NotificationChannelType = 'discord' | 'slack' | 'webhook' | 'email'

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
  failure_count: number
  avg_latency_ms: number
}

export interface NotificationChannel {
  id: string
  name: string
  type: NotificationChannelType
  webhook_url: string | null
  email_to: string[] | null
  enabled: boolean
}

export interface ChannelAssignment {
  channel_id: string
  scope_type: 'test' | 'tag'
  scope_value: string
}

export interface TestState {
  test_id: string
  last_status: TestStatus | null
  consecutive_failures: number
  last_notification_at: Date | null
  last_run_at: Date | null
}

export interface TestSummary {
  id: string
  name: string
  enabled: boolean
  tags: string[]
  last_status: TestStatus | null
  last_run_at: string | null
  pass_rate_7d: number | null
  avg_latency_ms: number | null
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

export interface PublicStatusTest {
  id: string
  name: string
  enabled: boolean
  tags: string[]
  current_status: PublicStatusOutcome
  uptime_pct_30d: number | null
  days: PublicStatusDay[]
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
