/**
 * Integration tests for stored incidents — real Postgres (the throwaway test database).
 * Drives state through the result buffer, then checks the incident routes and the public
 * status routes. Skips when no database is reachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { nanoid } from 'nanoid'
import type { TestStatus } from '@sentinel/shared'
import { flush, enqueue } from './result-buffer.js'
import { reconcileIncidents } from './queries/incidents.js'
import { signJwt } from '../auth/jwt.js'
import { buildServer } from '../server.js'
import { clearPublicCache } from '../routes/public-cache.js'

const DATABASE_URL = process.env['DATABASE_URL']

async function checkDbAvailable(): Promise<boolean> {
  if (!DATABASE_URL) return false
  const probe = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 })
  try {
    await probe.connect()
    await probe.end()
    return true
  } catch {
    return false
  }
}

const dbAvailable = await checkDbAvailable()
const client = new pg.Client({ connectionString: DATABASE_URL! })

const P = 'integ-inc-'
const person = { authorization: `Bearer ${signJwt({ sub: 'admin' })}` }
const agent = { authorization: `Bearer ${signJwt({ sub: 'mcp', label: 'ops-agent' })}` }

// Recent timestamps, so the runs land in an existing monthly partition.
let clock = Date.now() - 6 * 3_600_000
function run(testId: string, status: TestStatus) {
  clock += 60_000
  return {
    id: `${P}run-${nanoid(8)}`,
    test_id: testId,
    started_at: new Date(clock),
    finished_at: new Date(clock + 100),
    status,
    duration_ms: 100,
    error_message: status === 'success' ? null : 'upstream returned 502 from pod checkout-7f9c',
    assertions: [],
  }
}

async function record(testId: string, status: TestStatus): Promise<void> {
  enqueue(run(testId, status))
  await flush()
}

async function createTest(id: string, tags: string[], threshold: number): Promise<void> {
  await client.query(
    `INSERT INTO tests (id, name, code, schedule_ms, timeout_ms, retries, uses_browser, enabled, tags, failure_threshold, cooldown_ms)
     VALUES ($1, $2, 'return true', 60000, 5000, 0, false, false, $3, $4, 0)`,
    [`${P}${id}`, `Check ${id.toUpperCase()}`, tags, threshold],
  )
}

async function incidentsOf(testId: string) {
  const { rows } = await client.query<{ id: string; state: string; severity: string; resolved_at: Date | null; failed_runs: number | null; duration_ms: string | null; title: string }>(
    `SELECT DISTINCT i.id, i.state, i.severity, i.resolved_at, i.failed_runs, i.duration_ms, i.title
       FROM incidents i JOIN incident_tests it ON it.incident_id = i.id
      WHERE it.test_id = $1 ORDER BY i.id`,
    [`${P}${testId}`],
  )
  return rows
}

async function cleanup(): Promise<void> {
  await client.query(`DELETE FROM incidents WHERE id IN (SELECT incident_id FROM incident_tests WHERE test_id LIKE '${P}%' OR test_name LIKE 'Check %')`)
  await client.query(`DELETE FROM tests WHERE id LIKE '${P}%'`)
}

beforeAll(async () => {
  if (!dbAvailable) return
  await client.connect()
  await cleanup()
})

afterAll(async () => {
  if (!dbAvailable) return
  await cleanup()
  await client.end()
})

describe.skipIf(!dbAvailable)('stored incidents', () => {
  beforeEach(async () => {
    await cleanup()
    clearPublicCache()
  })

  it('opens on Outage, lets a grouped test join, and resolves when every test is Operational', async () => {
    await createTest('a', ['shop', 'incident:shop'], 1)
    await createTest('b', ['shop', 'incident:shop'], 3)
    await createTest('c', ['other'], 1)

    await record(`${P}a`, 'fail')
    const [opened] = await incidentsOf('a')
    expect(opened).toMatchObject({ state: 'investigating', severity: 'down', title: 'Check A outage', resolved_at: null })

    // B is only Degraded (1 of 3 failures): it joins the open incident of its group
    await record(`${P}b`, 'fail')
    expect((await incidentsOf('b')).map((i) => i.id)).toEqual([opened!.id])

    // C has no group: its own incident
    await record(`${P}c`, 'fail')
    const [cIncident] = await incidentsOf('c')
    expect(cIncident!.id).not.toBe(opened!.id)

    await record(`${P}a`, 'success')
    expect((await incidentsOf('a'))[0]!.resolved_at).toBeNull() // B still affected

    await record(`${P}b`, 'success')
    const [resolved] = await incidentsOf('a')
    expect(resolved).toMatchObject({ state: 'resolved' })
    expect(resolved!.resolved_at).toBeInstanceOf(Date)
    expect(resolved!.failed_runs).toBe(2)
    expect(Number(resolved!.duration_ms)).toBeGreaterThan(0)

    const { rows: timeline } = await client.query<{ body: string; kind: string; author: string }>(
      `SELECT body, kind, author FROM incident_updates WHERE incident_id = $1 ORDER BY created_at, id`,
      [opened!.id],
    )
    expect(timeline.every((u) => u.kind === 'system' && u.author === 'system')).toBe(true)
    expect(timeline[0]!.body).toBe('Opened: Check A is in Outage (1 failure).')
    expect(timeline.map((u) => u.body)).toContain('Check B joined the incident: Degraded.')
    expect(timeline.at(-1)!.body).toBe('Resolved: every affected test is Operational.')
  })

  it('never opens an incident for a test that is only Degraded', async () => {
    await createTest('d', ['incident:lonely'], 3)
    await record(`${P}d`, 'warn')
    await record(`${P}d`, 'fail')
    expect(await incidentsOf('d')).toEqual([])
  })

  it('reopens a link when a recovered test fails again while the incident is open', async () => {
    await createTest('e', ['incident:grp'], 1)
    await createTest('f', ['incident:grp'], 1)
    await record(`${P}e`, 'fail')
    await record(`${P}f`, 'fail')
    await record(`${P}e`, 'success')
    await record(`${P}e`, 'timeout')
    await record(`${P}f`, 'success')
    expect((await incidentsOf('e'))[0]!.resolved_at).toBeNull()
    await record(`${P}e`, 'success')
    expect((await incidentsOf('e'))[0]!.state).toBe('resolved')
  })

  it('the reconciler resolves an incident whose test is paused', async () => {
    await createTest('g', [], 1)
    await record(`${P}g`, 'fail')
    expect((await incidentsOf('g'))[0]!.resolved_at).toBeNull()
    await client.query(`UPDATE tests SET enabled = false WHERE id = $1`, [`${P}g`])
    const resolved = await reconcileIncidents()
    expect(resolved).toContain((await incidentsOf('g'))[0]!.id)
  })

  it('lets agents note and draft but only a person publish, and never leaks internal text', async () => {
    await createTest('h', ['public-tag'], 1)
    await record(`${P}h`, 'fail')
    const [incident] = await incidentsOf('h')
    const id = incident!.id
    const app = await buildServer()

    // agent: internal note ok, public note refused, report draft ok, publishing refused
    expect((await app.inject({ method: 'POST', url: `/incidents/${id}/updates`, headers: agent, payload: { body: 'INTERNAL-NOTE pod checkout-7f9c restarted' } })).statusCode).toBe(201)
    expect((await app.inject({ method: 'POST', url: `/incidents/${id}/updates`, headers: agent, payload: { body: 'x', public: true } })).statusCode).toBe(403)
    const draft = await app.inject({
      method: 'PUT', url: `/incidents/${id}/report`, headers: agent,
      payload: { summary: { internal: 'INTERNAL-SUMMARY node pool exhausted', public: 'Checkout was unavailable.' } },
    })
    expect(draft.statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `/incidents/${id}/publish`, headers: agent })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: `/incidents/${id}/report/publish`, headers: agent })).statusCode).toBe(403)

    // the agent's note is authored by its token label
    const detail = (await app.inject({ method: 'GET', url: `/incidents/${id}`, headers: person })).json() as { updates: Array<{ author: string; body: string }>; report: { published_at: string | null } }
    expect(detail.updates.find((u) => u.body.startsWith('INTERNAL-NOTE'))!.author).toBe('token:ops-agent')
    expect(detail.report.published_at).toBeNull()

    // not published yet: invisible publicly
    expect((await app.inject({ method: 'GET', url: `/status/incidents/${id}` })).statusCode).toBe(404)

    // person: state, public note, publish incident and report
    expect((await app.inject({ method: 'PATCH', url: `/incidents/${id}`, headers: person, payload: { state: 'identified' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `/incidents/${id}/updates`, headers: person, payload: { body: 'We are restoring checkout.', public: true } })).statusCode).toBe(201)
    expect((await app.inject({ method: 'POST', url: `/incidents/${id}/publish`, headers: person })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `/incidents/${id}/report/publish`, headers: person })).statusCode).toBe(200)

    const one = await app.inject({ method: 'GET', url: `/status/incidents/${id}` })
    expect(one.statusCode).toBe(200)
    expect(one.json()).toMatchObject({
      id,
      state: 'identified',
      tests: ['Check H'],
      updates: [{ body: 'We are restoring checkout.' }],
      report: { summary: 'Checkout was unavailable.', impact: '' },
    })
    const list = await app.inject({ method: 'GET', url: '/status/incidents?tag=public-tag' })
    expect((list.json() as Array<{ id: string }>).map((i) => i.id)).toEqual([id])
    expect((await app.inject({ method: 'GET', url: '/status/incidents?tag=no-such-tag' })).json()).toEqual([])

    for (const body of [one.body, list.body]) {
      expect(body).not.toContain('INTERNAL-')
      expect(body).not.toContain('checkout-7f9c')
      expect(body).not.toContain('token:')
      expect(body).not.toContain('user:')
      expect(body).not.toContain('State changed')
    }

    // unpublish hides it again
    expect((await app.inject({ method: 'POST', url: `/incidents/${id}/unpublish`, headers: person })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/status/incidents/${id}` })).statusCode).toBe(404)
  })

  it('refuses to publish an empty report and lists incidents by state', async () => {
    await createTest('i', [], 1)
    await record(`${P}i`, 'fail')
    const [incident] = await incidentsOf('i')
    const app = await buildServer()
    expect((await app.inject({ method: 'POST', url: `/incidents/${incident!.id}/report/publish`, headers: person })).statusCode).toBe(404)
    await app.inject({ method: 'PUT', url: `/incidents/${incident!.id}/report`, headers: person, payload: { impact: { internal: 'only internal' } } })
    expect((await app.inject({ method: 'POST', url: `/incidents/${incident!.id}/report/publish`, headers: person })).statusCode).toBe(400)

    const open = (await app.inject({ method: 'GET', url: '/incidents?state=open', headers: person })).json() as Array<{ id: string; report_state: string }>
    expect(open.find((i) => i.id === incident!.id)?.report_state).toBe('draft')
    expect((await app.inject({ method: 'GET', url: '/incidents?state=bogus', headers: person })).statusCode).toBe(400)

    // resolving by hand fills the snapshot; a later failure opens a new incident
    const res = await app.inject({ method: 'PATCH', url: `/incidents/${incident!.id}`, headers: person, payload: { state: 'resolved' } })
    expect(res.json()).toMatchObject({ state: 'resolved' })
    await record(`${P}i`, 'fail')
    expect((await incidentsOf('i')).length).toBe(2)
  })

  it('keeps GET /tests/:id/incidents in its old shape', async () => {
    await createTest('j', [], 1)
    await record(`${P}j`, 'fail')
    await record(`${P}j`, 'success')
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: `/tests/${P}j/incidents`, headers: person })
    expect(res.statusCode).toBe(200)
    const [one] = res.json() as Array<Record<string, unknown>>
    expect(Object.keys(one!).sort()).toEqual(['duration_ms', 'ended_at', 'failure_count', 'ongoing', 'started_at'])
  })
})
