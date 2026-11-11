import { formatDuration, periodOutcome, uptimePct } from '@sentinel/shared'
import type { StatusBucket, StatusPeriod } from '@sentinel/shared'

export { formatDuration }

/** Periods as people read them. */
export const PERIOD_LABELS: Record<StatusPeriod, string> = { '1h': '1 h', '24h': '24 h', '7d': '7 d', '30d': '30 d' }
export const PERIODS: readonly StatusPeriod[] = ['1h', '24h', '7d', '30d']
export const PUBLIC_PERIODS: readonly StatusPeriod[] = ['24h', '7d', '30d']

export function isPeriod(v: string | null | undefined): v is StatusPeriod {
  return v !== null && v !== undefined && (PERIODS as readonly string[]).includes(v)
}

/** Axis label at the left end of a history strip. */
export const PERIOD_START_LABELS: Record<StatusPeriod, string> = {
  '1h': '1 h ago',
  '24h': '24 h ago',
  '7d': '7 days ago',
  '30d': '30 days ago',
}

export type TimeZoneMode = 'utc' | 'local'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parts(iso: string | Date, tz: TimeZoneMode) {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return tz === 'utc'
    ? { y: d.getUTCFullYear(), mo: d.getUTCMonth(), day: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }
    : { y: d.getFullYear(), mo: d.getMonth(), day: d.getDate(), h: d.getHours(), mi: d.getMinutes() }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "18:43 UTC" or "18:43" (local). */
export function clockTime(iso: string | Date, tz: TimeZoneMode = 'utc'): string {
  const p = parts(iso, tz)
  return `${pad(p.h)}:${pad(p.mi)}${tz === 'utc' ? ' UTC' : ''}`
}

/** "9 Nov" (with the year when it is not this year). */
export function shortDate(iso: string | Date, tz: TimeZoneMode = 'utc', now: Date = new Date()): string {
  const p = parts(iso, tz)
  const thisYear = tz === 'utc' ? now.getUTCFullYear() : now.getFullYear()
  return `${p.day} ${MONTHS[p.mo]}${p.y === thisYear ? '' : ` ${p.y}`}`
}

/** Clock time for today, date and clock time otherwise: "18:43 UTC", "8 Nov, 03:12 UTC". */
export function dateTime(iso: string | Date, tz: TimeZoneMode = 'utc', now: Date = new Date()): string {
  const p = parts(iso, tz)
  const n = parts(now, tz)
  const sameDay = p.y === n.y && p.mo === n.mo && p.day === n.day
  return sameDay ? clockTime(iso, tz) : `${shortDate(iso, tz, now)}, ${clockTime(iso, tz)}`
}

/** "12 Sep 2026" */
export function longDate(iso: string | Date, tz: TimeZoneMode = 'utc'): string {
  const p = parts(iso, tz)
  return `${p.day} ${MONTHS[p.mo]} ${p.y}`
}

/** "40 s ago", "3 min ago", "5 h ago"; a date for anything a day old or more. */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '—'
  const ms = now.getTime() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  if (ms < 24 * 3_600_000) {
    if (ms < 10_000) return 'just now'
    return `${formatDuration(ms).replace(/ \d+ min$/, '')} ago`
  }
  return shortDate(iso, 'utc', now)
}

/** "214 ms", "1,240 ms", "30.0 s" for long ones. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.round(ms).toLocaleString('en-US')} ms`
}

/** Uptime over buckets with one decimal ("99.2"), or null without runs. */
export function bucketsUptime(buckets: StatusBucket[]): number | null {
  let s = 0
  let w = 0
  let f = 0
  for (const b of buckets) {
    s += b.success_count
    w += b.warn_count ?? 0
    f += b.failure_count
  }
  return uptimePct(s, w, f, 1)
}

/** "99.2%", "100%", "—". */
export function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return '—'
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}

export type CellKind = 'operational' | 'degraded' | 'outage' | 'none'

/** Colour of one history cell: every run passed, mixed, every run failed, or no runs. */
export function bucketKind(b: Pick<StatusBucket, 'success_count' | 'failure_count'> & { warn_count?: number }): CellKind {
  const o = periodOutcome(b.success_count, b.warn_count ?? 0, b.failure_count)
  return o === 'up' ? 'operational' : o === 'degraded' ? 'degraded' : o === 'down' ? 'outage' : 'none'
}

/** Picks `target` evenly spaced buckets (grid cards show 30 cells whatever the period). */
export function sampleBuckets<T>(buckets: T[], target: number): T[] {
  if (buckets.length <= target) return buckets
  const step = buckets.length / target
  return Array.from({ length: target }, (_, i) => buckets[Math.floor(i * step)]!)
}

/** Splits `key:value` tags so the key can be set apart. */
export function splitTag(tag: string): { key: string | null; value: string } {
  const i = tag.indexOf(':')
  return i > 0 ? { key: tag.slice(0, i + 1), value: tag.slice(i + 1) } : { key: null, value: tag }
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}
