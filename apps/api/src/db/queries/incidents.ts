import type pg from 'pg'
import { nanoid } from 'nanoid'
import {
  FAILURE_STATUSES,
  REPORT_SECTIONS,
  STATE_LABELS,
  incidentGroupOf,
  toIso,
  worseStatus,
  type IncidentDetail,
  type IncidentListItem,
  type IncidentReport,
  type IncidentReportInput,
  type IncidentSeverity,
  type IncidentState,
  type IncidentTestLink,
  type IncidentUpdate,
  type PublicIncident,
  type PublicStatusOutcome,
  type ReportSection,
  type StoredIncident,
  type TestStatus,
} from '@sentinel/shared'
import { pool } from '../pool.js'

type Db = pg.PoolClient | pg.Pool

const FAILURE_SQL = FAILURE_STATUSES.map((s) => `'${s}'`).join(',')

/** The parts of a test's state change the incident engine needs (see result-buffer.ts). */
export interface IncidentTransitionInput {
  test_id: string
  test_name: string
  test_tags: string[]
  prev_public_status: PublicStatusOutcome
  public_status: Exclude<PublicStatusOutcome, 'unknown'>
  consecutive_failures: number
  run: { started_at: Date; finished_at: Date; status: TestStatus }
}

/** What changed for a test's incident in this pass, handed to the notifier. */
export interface IncidentLink {
  incident_id: string
  transition: 'opened' | 'joined' | 'updated' | 'test_recovered' | 'resolved' | 'unchanged'
}

interface OpenLinkRow {
  link_id: string
  incident_id: string
  test_id: string
  ended_at: Date | null
  worst_status: IncidentSeverity
  severity: IncidentSeverity
}

interface PendingUpdate {
  incident_id: string
  body: string
  at: Date
}

function stateWord(status: PublicStatusOutcome): string {
  return STATE_LABELS[status]
}

function failuresText(n: number): string {
  return n === 1 ? '1 failure' : `${n} failures`
}

/**
 * Opens, joins, updates and resolves incidents from one chunk of state changes, inside the
 * caller's transaction (the result buffer's). Rules:
 *
 * - A test entering Outage joins the open incident of its `incident:<group>`, else opens one.
 * - A test that is only Degraded joins an already-open incident of its group; it never opens one.
 * - A linked test changing state writes a system update and can raise the incident's severity.
 * - A linked test back to Operational ends its link; when no linked test is left in trouble the
 *   incident resolves and keeps its duration and failed-run count.
 *
 * Returns, per test id, the incident it belongs to and what happened to it.
 */
export async function applyIncidentTransitions(
  client: pg.PoolClient,
  transitions: IncidentTransitionInput[],
): Promise<Map<string, IncidentLink>> {
  const result = new Map<string, IncidentLink>()
  if (transitions.length === 0) return result

  const testIds = transitions.map((t) => t.test_id)
  const { rows: links } = await client.query<OpenLinkRow>(
    `SELECT it.id AS link_id, it.incident_id, it.test_id, it.ended_at, it.worst_status, i.severity
       FROM incident_tests it
       JOIN incidents i ON i.id = it.incident_id
      WHERE it.test_id = ANY($1) AND i.resolved_at IS NULL`,
    [testIds],
  )
  const linkByTest = new Map(links.map((l) => [l.test_id, l]))

  const groups = [...new Set(
    transitions
      .filter((t) => !linkByTest.has(t.test_id) && t.public_status !== 'up')
      .map((t) => incidentGroupOf(t.test_tags))
      .filter((g): g is string => g !== null),
  )]
  const openByGroup = new Map<string, { id: string; severity: IncidentSeverity }>()
  if (groups.length > 0) {
    const { rows } = await client.query<{ id: string; group_key: string; severity: IncidentSeverity }>(
      `SELECT DISTINCT ON (group_key) id, group_key, severity
         FROM incidents
        WHERE resolved_at IS NULL AND group_key = ANY($1)
        ORDER BY group_key, started_at`,
      [groups],
    )
    for (const r of rows) openByGroup.set(r.group_key, { id: r.id, severity: r.severity })
  }

  const severity = new Map<string, { from: IncidentSeverity; to: IncidentSeverity }>()
  const raise = (incidentId: string, current: IncidentSeverity, to: IncidentSeverity): void => {
    const entry = severity.get(incidentId) ?? { from: current, to: current }
    entry.to = worseStatus(entry.to, to)
    severity.set(incidentId, entry)
  }
  const updates: PendingUpdate[] = []
  const recovered = new Set<string>()

  for (const t of transitions) {
    const at = t.run.finished_at
    const link = linkByTest.get(t.test_id)
    const changed = t.prev_public_status !== t.public_status

    if (link !== undefined) {
      if (t.public_status === 'up') {
        if (link.ended_at === null) {
          await client.query('UPDATE incident_tests SET ended_at = $2 WHERE id = $1', [link.link_id, at])
          updates.push({ incident_id: link.incident_id, at, body: `${t.test_name} is ${stateWord('up')}.` })
          recovered.add(link.incident_id)
          result.set(t.test_id, { incident_id: link.incident_id, transition: 'test_recovered' })
        } else {
          result.set(t.test_id, { incident_id: link.incident_id, transition: 'unchanged' })
        }
        continue
      }
      const status = t.public_status
      if (link.ended_at !== null || changed) {
        await client.query(
          `UPDATE incident_tests
              SET ended_at = NULL,
                  worst_status = CASE WHEN worst_status = 'down' OR $2 = 'down' THEN 'down' ELSE 'degraded' END
            WHERE id = $1`,
          [link.link_id, status],
        )
        const again = link.ended_at !== null ? ' again' : ''
        const detail = status === 'down' ? ` (${failuresText(t.consecutive_failures)})` : ''
        updates.push({ incident_id: link.incident_id, at, body: `${t.test_name} is in ${stateWord(status)}${again}${detail}.` })
        raise(link.incident_id, link.severity, status)
        result.set(t.test_id, { incident_id: link.incident_id, transition: 'updated' })
      } else {
        result.set(t.test_id, { incident_id: link.incident_id, transition: 'unchanged' })
      }
      continue
    }

    if (t.public_status === 'up') continue
    const status = t.public_status
    const group = incidentGroupOf(t.test_tags)
    const groupIncident = group === null ? undefined : openByGroup.get(group)

    if (groupIncident !== undefined) {
      await insertLink(client, groupIncident.id, t, status)
      updates.push({ incident_id: groupIncident.id, at, body: `${t.test_name} joined the incident: ${stateWord(status)}.` })
      raise(groupIncident.id, groupIncident.severity, status)
      linkByTest.set(t.test_id, { link_id: '', incident_id: groupIncident.id, test_id: t.test_id, ended_at: null, worst_status: status, severity: groupIncident.severity })
      result.set(t.test_id, { incident_id: groupIncident.id, transition: 'joined' })
      continue
    }

    if (status !== 'down') continue
    const id = nanoid()
    await client.query(
      `INSERT INTO incidents (id, title, severity, state, started_at, group_key)
       VALUES ($1, $2, 'down', 'investigating', $3, $4)`,
      [id, `${t.test_name} outage`, t.run.started_at, group],
    )
    await insertLink(client, id, t, 'down')
    updates.push({ incident_id: id, at, body: `Opened: ${t.test_name} is in ${stateWord('down')} (${failuresText(t.consecutive_failures)}).` })
    if (group !== null) openByGroup.set(group, { id, severity: 'down' })
    linkByTest.set(t.test_id, { link_id: '', incident_id: id, test_id: t.test_id, ended_at: null, worst_status: 'down', severity: 'down' })
    result.set(t.test_id, { incident_id: id, transition: 'opened' })
  }

  for (const [incidentId, { from, to }] of severity) {
    if (from !== to) {
      await client.query(`UPDATE incidents SET severity = $2, updated_at = NOW() WHERE id = $1`, [incidentId, to])
    }
  }

  if (recovered.size > 0) {
    const at = new Date(Math.max(...transitions.map((t) => t.run.finished_at.getTime())))
    const resolved = await resolveIfRecovered(client, [...recovered], at)
    // 1 ms after the last recovery, so the timeline always ends with it
    const resolvedAt = new Date(at.getTime() + 1)
    for (const id of resolved) updates.push({ incident_id: id, at: resolvedAt, body: 'Resolved: every affected test is Operational.' })
    for (const [testId, link] of result) {
      if (resolved.includes(link.incident_id) && link.transition === 'test_recovered') {
        result.set(testId, { incident_id: link.incident_id, transition: 'resolved' })
      }
    }
  }

  await insertSystemUpdates(client, updates)
  return result
}

async function insertLink(client: Db, incidentId: string, t: IncidentTransitionInput, status: IncidentSeverity): Promise<void> {
  await client.query(
    `INSERT INTO incident_tests (id, incident_id, test_id, test_name, started_at, worst_status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (incident_id, test_id) WHERE test_id IS NOT NULL
     DO UPDATE SET ended_at = NULL,
                   worst_status = CASE WHEN incident_tests.worst_status = 'down' OR EXCLUDED.worst_status = 'down' THEN 'down' ELSE 'degraded' END`,
    [nanoid(), incidentId, t.test_id, t.test_name, t.run.started_at, status],
  )
}

async function insertSystemUpdates(client: Db, updates: PendingUpdate[]): Promise<void> {
  if (updates.length === 0) return
  const values: unknown[] = []
  const placeholders = updates.map((u, i) => {
    const b = i * 4
    values.push(nanoid(), u.incident_id, u.at, u.body)
    return `($${b + 1}, $${b + 2}, $${b + 3}, 'system', $${b + 4}, 'system', FALSE)`
  })
  await client.query(
    `INSERT INTO incident_updates (id, incident_id, created_at, kind, body, author, public) VALUES ${placeholders.join(', ')}`,
    values,
  )
}

/**
 * Resolves the given incidents that no longer have a linked test in trouble, filling the
 * duration and failed-run snapshot. Returns the ids it resolved.
 */
export async function resolveIfRecovered(client: Db, incidentIds: string[], at: Date): Promise<string[]> {
  if (incidentIds.length === 0) return []
  const { rows } = await client.query<{ id: string }>(
    `UPDATE incidents i
        SET state = 'resolved',
            resolved_at = $2,
            updated_at = NOW(),
            duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM ($2::timestamptz - i.started_at)) * 1000)::bigint),
            failed_runs = (
              SELECT COUNT(*) FROM test_runs r
                JOIN incident_tests it ON it.test_id = r.test_id AND it.incident_id = i.id
               WHERE r.started_at >= i.started_at AND r.started_at <= $2 AND r.status IN (${FAILURE_SQL})
            )
      WHERE i.id = ANY($1)
        AND i.resolved_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM incident_tests it
           WHERE it.incident_id = i.id AND it.test_id IS NOT NULL AND it.ended_at IS NULL
        )
      RETURNING i.id`,
    [incidentIds, at],
  )
  return rows.map((r) => r.id)
}

/**
 * Reconciler pass: ends links whose test is Operational or paused, then resolves open incidents
 * left without an affected test (including ones whose tests were all deleted). Returns the
 * resolved ids.
 */
export async function reconcileIncidents(): Promise<string[]> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE incident_tests it
          SET ended_at = COALESCE(ts.problem_ended_at, ts.last_run_at, NOW())
         FROM incidents i, tests t
         LEFT JOIN test_state ts ON ts.test_id = t.id
        WHERE i.id = it.incident_id AND t.id = it.test_id
          AND i.resolved_at IS NULL AND it.ended_at IS NULL
          AND (ts.public_status = 'up' OR t.enabled = FALSE)`,
    )
    const { rows: candidates } = await client.query<{ id: string }>(
      `SELECT i.id FROM incidents i
        WHERE i.resolved_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM incident_tests it WHERE it.incident_id = i.id AND it.test_id IS NOT NULL AND it.ended_at IS NULL)`,
    )
    const at = new Date()
    const resolved = await resolveIfRecovered(client, candidates.map((c) => c.id), at)
    await insertSystemUpdates(client, resolved.map((id) => ({ incident_id: id, at, body: 'Resolved: every affected test is Operational.' })))
    await client.query('COMMIT')
    return resolved
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// --- reads ---------------------------------------------------------------------------------

const INCIDENT_COLUMNS =
  'id, title, severity, state, started_at, resolved_at, published_at, group_key, duration_ms, failed_runs, created_at, updated_at'

interface IncidentRow {
  id: string
  title: string
  severity: IncidentSeverity
  state: IncidentState
  started_at: Date
  resolved_at: Date | null
  published_at: Date | null
  group_key: string | null
  duration_ms: string | number | null
  failed_runs: number | null
  created_at: Date
  updated_at: Date
}

function toIncident(r: IncidentRow): StoredIncident {
  return {
    id: r.id,
    title: r.title,
    severity: r.severity,
    state: r.state,
    started_at: toIso(r.started_at)!,
    resolved_at: toIso(r.resolved_at),
    published_at: toIso(r.published_at),
    group_key: r.group_key,
    duration_ms: r.duration_ms === null ? null : Number(r.duration_ms),
    failed_runs: r.failed_runs === null ? null : Number(r.failed_runs),
    created_at: toIso(r.created_at)!,
    updated_at: toIso(r.updated_at)!,
  }
}

interface LinkRow {
  incident_id: string
  test_id: string | null
  test_name: string
  started_at: Date
  ended_at: Date | null
  worst_status: IncidentSeverity
}

function toLink(r: LinkRow): IncidentTestLink {
  return { test_id: r.test_id, test_name: r.test_name, started_at: toIso(r.started_at)!, ended_at: toIso(r.ended_at), worst_status: r.worst_status }
}

async function linksFor(ids: string[], db: Db = pool): Promise<Map<string, IncidentTestLink[]>> {
  const out = new Map<string, IncidentTestLink[]>()
  if (ids.length === 0) return out
  // The current test name wins over the one stored at link time (renames); deleted tests keep theirs.
  const { rows } = await db.query<LinkRow>(
    `SELECT it.incident_id, it.test_id, COALESCE(t.name, it.test_name) AS test_name, it.started_at, it.ended_at, it.worst_status
       FROM incident_tests it LEFT JOIN tests t ON t.id = it.test_id
      WHERE it.incident_id = ANY($1)
      ORDER BY it.started_at`,
    [ids],
  )
  for (const r of rows) {
    const list = out.get(r.incident_id) ?? []
    list.push(toLink(r))
    out.set(r.incident_id, list)
  }
  return out
}

export type IncidentListState = 'open' | 'resolved' | 'all'

export async function listIncidents(state: IncidentListState, limit = 100): Promise<IncidentListItem[]> {
  const where = state === 'open' ? 'WHERE i.resolved_at IS NULL' : state === 'resolved' ? 'WHERE i.resolved_at IS NOT NULL' : ''
  const { rows } = await pool.query<IncidentRow & { report_published_at: Date | null; has_report: boolean }>(
    `SELECT ${INCIDENT_COLUMNS.split(', ').map((c) => `i.${c}`).join(', ')},
            r.published_at AS report_published_at, (r.incident_id IS NOT NULL) AS has_report
       FROM incidents i LEFT JOIN incident_reports r ON r.incident_id = i.id
       ${where}
      ORDER BY (i.resolved_at IS NULL) DESC, i.started_at DESC
      LIMIT $1`,
    [limit],
  )
  const links = await linksFor(rows.map((r) => r.id))
  return rows.map((r) => ({
    ...toIncident(r),
    tests: links.get(r.id) ?? [],
    report_state: r.report_published_at !== null ? 'published' : r.has_report ? 'draft' : 'none',
  }))
}

export async function getIncidentRow(id: string, db: Db = pool): Promise<StoredIncident | null> {
  const { rows } = await db.query<IncidentRow>(`SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE id = $1`, [id])
  return rows[0] === undefined ? null : toIncident(rows[0])
}

interface ReportRow {
  published_at: Date | null
  updated_at: Date
  [column: string]: unknown
}

function toReport(r: ReportRow): IncidentReport {
  const sections = Object.fromEntries(
    REPORT_SECTIONS.map((s) => [s, { internal: String(r[`${s}_internal`] ?? ''), public: String(r[`${s}_public`] ?? '') }]),
  ) as IncidentReport['sections']
  return { sections, published_at: toIso(r.published_at), updated_at: toIso(r.updated_at)! }
}

async function reportFor(id: string): Promise<IncidentReport | null> {
  const { rows } = await pool.query<ReportRow>('SELECT * FROM incident_reports WHERE incident_id = $1', [id])
  return rows[0] === undefined ? null : toReport(rows[0])
}

export async function getIncidentDetail(id: string): Promise<IncidentDetail | null> {
  const incident = await getIncidentRow(id)
  if (incident === null) return null
  const [links, updates, report] = await Promise.all([linksFor([id]), listUpdates(id), reportFor(id)])
  return { ...incident, tests: links.get(id) ?? [], updates, report }
}

async function listUpdates(id: string, publicOnly = false): Promise<IncidentUpdate[]> {
  const { rows } = await pool.query<{ id: string; created_at: Date; kind: 'system' | 'note'; body: string; author: string; public: boolean }>(
    `SELECT id, created_at, kind, body, author, public FROM incident_updates
      WHERE incident_id = $1 ${publicOnly ? 'AND public = TRUE' : ''}
      ORDER BY created_at, id`,
    [id],
  )
  return rows.map((r) => ({ ...r, created_at: toIso(r.created_at)! }))
}

// --- writes from people and agents ------------------------------------------------------------

export async function addIncidentUpdate(input: { incident_id: string; body: string; author: string; public: boolean; kind?: 'system' | 'note' }): Promise<IncidentUpdate> {
  const { rows } = await pool.query<{ id: string; created_at: Date; kind: 'system' | 'note'; body: string; author: string; public: boolean }>(
    `INSERT INTO incident_updates (id, incident_id, kind, body, author, public)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at, kind, body, author, public`,
    [nanoid(), input.incident_id, input.kind ?? 'note', input.body, input.author, input.public],
  )
  await pool.query('UPDATE incidents SET updated_at = NOW() WHERE id = $1', [input.incident_id])
  const r = rows[0]!
  return { ...r, created_at: toIso(r.created_at)! }
}

/** Sets title and/or state. Moving to resolved fills the snapshot; leaving resolved reopens it. */
export async function updateIncident(id: string, change: { title?: string | undefined; state?: IncidentState | undefined }, author: string): Promise<StoredIncident | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const before = await getIncidentRow(id, client)
    if (before === null) {
      await client.query('ROLLBACK')
      return null
    }
    const notes: string[] = []
    if (change.title !== undefined && change.title !== before.title) {
      await client.query('UPDATE incidents SET title = $2, updated_at = NOW() WHERE id = $1', [id, change.title])
      notes.push(`Title changed to "${change.title}".`)
    }
    if (change.state !== undefined && change.state !== before.state) {
      if (change.state === 'resolved') {
        const now = new Date()
        await client.query(
          `UPDATE incidents i
              SET state = 'resolved', resolved_at = $2, updated_at = NOW(),
                  duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM ($2::timestamptz - i.started_at)) * 1000)::bigint),
                  failed_runs = (
                    SELECT COUNT(*) FROM test_runs r
                      JOIN incident_tests it ON it.test_id = r.test_id AND it.incident_id = i.id
                     WHERE r.started_at >= i.started_at AND r.started_at <= $2 AND r.status IN (${FAILURE_SQL})
                  )
            WHERE i.id = $1`,
          [id, now],
        )
        await client.query('UPDATE incident_tests SET ended_at = $2 WHERE incident_id = $1 AND ended_at IS NULL', [id, now])
      } else {
        await client.query(
          `UPDATE incidents SET state = $2, updated_at = NOW(),
                  resolved_at = NULL, duration_ms = NULL, failed_runs = NULL
            WHERE id = $1`,
          [id, change.state],
        )
      }
      notes.push(`State changed to ${change.state[0]!.toUpperCase()}${change.state.slice(1)}.`)
    }
    for (const body of notes) {
      await client.query(
        `INSERT INTO incident_updates (id, incident_id, kind, body, author, public) VALUES ($1, $2, 'system', $3, $4, FALSE)`,
        [nanoid(), id, body, author],
      )
    }
    const after = await getIncidentRow(id, client)
    await client.query('COMMIT')
    return after
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Links a test by hand. 'not_found' when the test does not exist. */
export async function linkTestToIncident(incidentId: string, testId: string, author: string): Promise<'ok' | 'not_found' | 'already_linked'> {
  const { rows: tests } = await pool.query<{ id: string; name: string; public_status: PublicStatusOutcome | null }>(
    `SELECT t.id, t.name, ts.public_status FROM tests t LEFT JOIN test_state ts ON ts.test_id = t.id WHERE t.id = $1`,
    [testId],
  )
  const test = tests[0]
  if (test === undefined) return 'not_found'
  const worst: IncidentSeverity = test.public_status === 'down' ? 'down' : 'degraded'
  const ended = test.public_status === 'up' ? new Date() : null
  const { rowCount } = await pool.query(
    `INSERT INTO incident_tests (id, incident_id, test_id, test_name, started_at, ended_at, worst_status)
     VALUES ($1, $2, $3, $4, NOW(), $5, $6)
     ON CONFLICT (incident_id, test_id) WHERE test_id IS NOT NULL DO NOTHING`,
    [nanoid(), incidentId, test.id, test.name, ended, worst],
  )
  if ((rowCount ?? 0) === 0) return 'already_linked'
  await addIncidentUpdate({ incident_id: incidentId, kind: 'system', body: `${test.name} was linked to the incident.`, author, public: false })
  return 'ok'
}

/** Replaces the given sections/versions of the report, creating it as a draft if needed. */
export async function saveReport(incidentId: string, input: IncidentReportInput): Promise<IncidentReport> {
  const sets: string[] = []
  const values: unknown[] = [incidentId]
  for (const section of REPORT_SECTIONS) {
    const v = input[section as ReportSection]
    if (v === undefined) continue
    for (const version of ['internal', 'public'] as const) {
      const text = v[version]
      if (text === undefined) continue
      values.push(text)
      sets.push(`${section}_${version} = $${values.length}`)
    }
  }
  await pool.query('INSERT INTO incident_reports (incident_id) VALUES ($1) ON CONFLICT (incident_id) DO NOTHING', [incidentId])
  if (sets.length > 0) {
    await pool.query(`UPDATE incident_reports SET ${sets.join(', ')}, updated_at = NOW() WHERE incident_id = $1`, values)
  }
  return (await reportFor(incidentId))!
}

export async function setIncidentPublished(id: string, published: boolean): Promise<StoredIncident | null> {
  const { rows } = await pool.query<IncidentRow>(
    `UPDATE incidents SET published_at = ${published ? 'COALESCE(published_at, NOW())' : 'NULL'}, updated_at = NOW()
      WHERE id = $1 RETURNING ${INCIDENT_COLUMNS}`,
    [id],
  )
  return rows[0] === undefined ? null : toIncident(rows[0])
}

/** Publishes the report. 'empty' when no section has public text; 'no_report' without a report. */
export async function publishReport(id: string): Promise<IncidentReport | 'no_report' | 'empty'> {
  const report = await reportFor(id)
  if (report === null) return 'no_report'
  if (REPORT_SECTIONS.every((s) => report.sections[s].public.trim() === '')) return 'empty'
  await pool.query('UPDATE incident_reports SET published_at = COALESCE(published_at, NOW()), updated_at = NOW() WHERE incident_id = $1', [id])
  return (await reportFor(id))!
}

// --- public reads -----------------------------------------------------------------------------

const PUBLIC_WINDOW_DAYS = 30

function toPublic(incident: StoredIncident, tests: IncidentTestLink[], updates: IncidentUpdate[], report: IncidentReport | null): PublicIncident {
  return {
    id: incident.id,
    title: incident.title,
    severity: incident.severity,
    state: incident.state,
    started_at: incident.started_at,
    resolved_at: incident.resolved_at,
    published_at: incident.published_at!,
    tests: [...new Set(tests.map((t) => t.test_name))],
    updates: updates.filter((u) => u.public).map((u) => ({ id: u.id, created_at: u.created_at, body: u.body })),
    report:
      report !== null && report.published_at !== null
        ? (Object.fromEntries(REPORT_SECTIONS.map((s) => [s, report.sections[s].public])) as Record<ReportSection, string>)
        : null,
  }
}

/** Published incidents that are open or started in the last 30 days, optionally limited to a tag's tests. */
export async function listPublicIncidents(tag: string | null): Promise<PublicIncident[]> {
  const { rows } = await pool.query<IncidentRow>(
    `SELECT ${INCIDENT_COLUMNS.split(', ').map((c) => `i.${c}`).join(', ')}
       FROM incidents i
      WHERE i.published_at IS NOT NULL
        AND (i.resolved_at IS NULL OR i.started_at >= NOW() - make_interval(days => ${PUBLIC_WINDOW_DAYS}))
        AND ($1::text IS NULL OR EXISTS (
              SELECT 1 FROM incident_tests it JOIN tests t ON t.id = it.test_id
               WHERE it.incident_id = i.id AND $1 = ANY(t.tags)))
      ORDER BY (i.resolved_at IS NULL) DESC, i.started_at DESC
      LIMIT 100`,
    [tag],
  )
  const ids = rows.map((r) => r.id)
  const links = await linksFor(ids)
  const { rows: updateRows } = ids.length === 0
    ? { rows: [] as Array<{ incident_id: string; id: string; created_at: Date; body: string }> }
    : await pool.query<{ incident_id: string; id: string; created_at: Date; body: string }>(
        `SELECT incident_id, id, created_at, body FROM incident_updates
          WHERE incident_id = ANY($1) AND public = TRUE ORDER BY created_at, id`,
        [ids],
      )
  const { rows: reportRows } = ids.length === 0
    ? { rows: [] as Array<ReportRow & { incident_id: string }> }
    : await pool.query<ReportRow & { incident_id: string }>(
        'SELECT * FROM incident_reports WHERE incident_id = ANY($1) AND published_at IS NOT NULL',
        [ids],
      )
  const reports = new Map(reportRows.map((r) => [r.incident_id, toReport(r)]))
  return rows.map((r) => {
    const updates: IncidentUpdate[] = updateRows
      .filter((u) => u.incident_id === r.id)
      .map((u) => ({ id: u.id, created_at: toIso(u.created_at)!, body: u.body, kind: 'note', author: '', public: true }))
    return toPublic(toIncident(r), links.get(r.id) ?? [], updates, reports.get(r.id) ?? null)
  })
}

export async function getPublicIncident(id: string): Promise<PublicIncident | null> {
  const incident = await getIncidentRow(id)
  if (incident === null || incident.published_at === null) return null
  const [links, updates, report] = await Promise.all([linksFor([id]), listUpdates(id, true), reportFor(id)])
  return toPublic(incident, links.get(id) ?? [], updates, report)
}

/** Stored incident links of one test, oldest first, for GET /tests/:id/incidents. */
export async function storedIncidentsForTest(testId: string): Promise<Array<{ started_at: Date; ended_at: Date | null; failed_runs: number | null }>> {
  const { rows } = await pool.query<{ started_at: Date; ended_at: Date | null; failed_runs: number | null }>(
    `SELECT it.started_at, COALESCE(it.ended_at, i.resolved_at) AS ended_at, i.failed_runs
       FROM incident_tests it JOIN incidents i ON i.id = it.incident_id
      WHERE it.test_id = $1
      ORDER BY it.started_at`,
    [testId],
  )
  return rows
}
