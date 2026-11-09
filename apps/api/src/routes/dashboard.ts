import type { FastifyInstance } from 'fastify'
import type { StatusSection, TestSummary } from '@sentinel/shared'
import { STATUS_SECTIONS, compareInSection, statusSection } from '@sentinel/shared'
import { pool } from '../db/pool.js'

type SummaryRow = Omit<TestSummary, 'section'>

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return v instanceof Date ? v.toISOString() : String(v)
}

/** Parses `?section=critical,warning`; null when absent (no filter). */
export function parseSections(raw: string | undefined): Set<StatusSection> | null | 'invalid' {
  if (raw === undefined || raw === '') return null
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.some((p) => !(STATUS_SECTIONS as readonly string[]).includes(p))) return 'invalid'
  return new Set(parts as StatusSection[])
}

/** Adds each test's section and orders the list by section, then by the in-section rule. */
export function withSections<T extends Omit<TestSummary, 'section'>>(rows: T[], now = new Date()): Array<T & { section: StatusSection }> {
  const out = rows.map((r) => ({ ...r, section: statusSection(r, now) }))
  out.sort((a, b) => STATUS_SECTIONS.indexOf(a.section) - STATUS_SECTIONS.indexOf(b.section) || compareInSection(a.section, a, b))
  return out
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // GET /dashboard?tag=&section=critical,warning
  app.get<{ Querystring: { tag?: string; section?: string } }>('/', async (req, reply) => {
    const { tag } = req.query
    const sections = parseSections(req.query.section)
    if (sections === 'invalid') {
      return reply.status(400).send({ error: `section must be a comma-separated list of: ${STATUS_SECTIONS.join(', ')}` })
    }
    const { rows } = await pool.query<SummaryRow>(
      `SELECT
         t.id,
         t.name,
         t.enabled,
         t.tags,
         t.failure_threshold,
         ts.last_status,
         ts.last_run_at,
         COALESCE(ts.public_status, 'unknown') AS public_status,
         COALESCE(ts.consecutive_failures, 0) AS consecutive_failures,
         ts.problem_started_at,
         ts.problem_ended_at,
         ts.problem_worst,
         ts.last_problem_at,
         ROUND(
           100.0 * SUM(ud.success_count)::numeric /
           NULLIF(SUM(ud.success_count) + SUM(ud.failure_count), 0)
         )::integer AS pass_rate_7d,
         ROUND(AVG(ud.avg_latency_ms))::integer AS avg_latency_ms
       FROM tests t
       LEFT JOIN test_state ts ON ts.test_id = t.id
       LEFT JOIN uptime_daily ud
         ON ud.test_id = t.id AND ud.date >= CURRENT_DATE - 6
       WHERE ($1::text IS NULL OR $1 = ANY(t.tags))
       GROUP BY t.id, t.name, t.enabled, t.tags, t.failure_threshold, ts.last_status, ts.last_run_at,
                ts.public_status, ts.consecutive_failures, ts.problem_started_at, ts.problem_ended_at,
                ts.problem_worst, ts.last_problem_at`,
      [tag ?? null],
    )
    const normalized = rows.map((r) => ({
      ...r,
      last_run_at: iso(r.last_run_at),
      problem_started_at: iso(r.problem_started_at),
      problem_ended_at: iso(r.problem_ended_at),
      last_problem_at: iso(r.last_problem_at),
    }))
    const result = withSections(normalized)
    return reply.send(sections === null ? result : result.filter((r) => sections.has(r.section)))
  })
}
