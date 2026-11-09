import type { PublicStatusOutcome } from './types.js'

/**
 * Where a test is listed on the admin dashboard and the public status page, top to bottom.
 *
 * - `critical`  — state is down: failing for at least the test's failure threshold
 * - `warning`   — state is degraded: a warning, or a failure still under the threshold
 * - `recovered` — state is up, and a run in the last 24 h did not pass
 * - `clean`     — state is up (or not yet known) and every run in the last 24 h passed
 * - `disabled`  — the test is disabled, whatever its last state
 *
 * Sections follow the state Sentinel already keeps per run (`test_state.public_status`), so a
 * test's section always agrees with what the notifier was told. Tags (including any tier tag)
 * play no part.
 */
export type StatusSection = 'critical' | 'warning' | 'recovered' | 'clean' | 'disabled'

export const STATUS_SECTIONS: readonly StatusSection[] = ['critical', 'warning', 'recovered', 'clean', 'disabled']

/** How long a passing test stays in `recovered` after its last non-passing run. */
export const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000

/** The problem window kept on test_state, as the API returns it. */
export interface ProblemWindow {
  /** First run of the current (or most recent) streak of non-passing state. */
  problem_started_at: string | null
  /** First passing run after that streak; null while it is ongoing. */
  problem_ended_at: string | null
  /** Worst state reached during that streak. */
  problem_worst: 'down' | 'degraded' | null
  /** Most recent run that did not pass. */
  last_problem_at: string | null
}

export interface SectionInput {
  enabled: boolean
  public_status: PublicStatusOutcome
  last_problem_at: string | null
}

export function statusSection(test: SectionInput, now: Date = new Date()): StatusSection {
  if (!test.enabled) return 'disabled'
  if (test.public_status === 'down') return 'critical'
  if (test.public_status === 'degraded') return 'warning'
  if (test.last_problem_at !== null) {
    const age = now.getTime() - new Date(test.last_problem_at).getTime()
    if (age >= 0 && age < RECOVERY_WINDOW_MS) return 'recovered'
  }
  return 'clean'
}

/**
 * Orders tests inside one section: newest problem first for critical and warning, most recent
 * recovery first for recovered, alphabetical otherwise.
 */
export function compareInSection(
  section: StatusSection,
  a: ProblemWindow & { name: string },
  b: ProblemWindow & { name: string },
): number {
  const time = (v: string | null): number => (v === null ? 0 : new Date(v).getTime())
  if (section === 'critical' || section === 'warning') {
    return time(b.problem_started_at) - time(a.problem_started_at) || a.name.localeCompare(b.name)
  }
  if (section === 'recovered') {
    return time(b.problem_ended_at ?? b.last_problem_at) - time(a.problem_ended_at ?? a.last_problem_at) || a.name.localeCompare(b.name)
  }
  return a.name.localeCompare(b.name)
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function clock(iso: string, now: Date): string {
  const d = new Date(iso)
  const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
  if (now.getTime() - d.getTime() < 20 * 3_600_000) return hhmm
  return `${d.toISOString().slice(0, 10)} ${hhmm}`
}

export interface SinceText {
  text: string
  sub: string | null
  tone: 'critical' | 'warning' | 'recovered' | 'muted'
}

/**
 * The "since" line for one test. `failing` is known only on the admin dashboard (consecutive
 * failures under the threshold); the public page says "degraded" instead.
 */
export function sinceText(
  t: ProblemWindow & { section: StatusSection } & { failing?: { count: number; threshold: number } | null },
  now: Date,
): SinceText {
  const started = t.problem_started_at
  if (t.section === 'critical') {
    return {
      text: started ? `failing for ${formatDuration(now.getTime() - new Date(started).getTime())}` : 'failing',
      sub: started ? `since ${clock(started, now)}` : null,
      tone: 'critical',
    }
  }
  if (t.section === 'warning') {
    if (t.failing && t.failing.count > 0) {
      return { text: `failing, ${t.failing.count} of ${t.failing.threshold} runs`, sub: 'below the failure threshold', tone: 'warning' }
    }
    return {
      text: started ? `degraded for ${formatDuration(now.getTime() - new Date(started).getTime())}` : 'degraded',
      sub: started ? `since ${clock(started, now)}` : null,
      tone: 'warning',
    }
  }
  if (t.section === 'recovered') {
    const ended = t.problem_ended_at ?? t.last_problem_at
    const text = ended ? `recovered ${formatDuration(now.getTime() - new Date(ended).getTime())} ago` : 'recovered'
    let sub: string | null = null
    if (started && t.problem_ended_at) {
      const lasted = new Date(t.problem_ended_at).getTime() - new Date(started).getTime()
      sub = t.problem_worst === 'down' ? `was down for ${formatDuration(lasted)}` : `degraded for ${formatDuration(lasted)}`
    }
    return { text, sub, tone: 'recovered' }
  }
  if (t.section === 'disabled') return { text: 'disabled', sub: null, tone: 'muted' }
  return { text: '—', sub: null, tone: 'muted' }
}
