/**
 * Integration test for the RBMC sync's transactional core — hits real Postgres.
 *
 * Everything runs inside ONE transaction that is rolled back at the end, so it
 * is safe against any database (including a populated one) and leaves no rows,
 * no events, and no scheduler side effects behind. Skips when DATABASE_URL is
 * unreachable or migration 017 has not been applied.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyStations } from './sync.js'
import { RBMC_TEMPLATE_VERSION, buildStationTestCode } from './template.js'
import type { RbmcStationInput } from '../db/queries/rbmc.js'

const DATABASE_URL = process.env['DATABASE_URL']

async function checkDbReady(): Promise<boolean> {
  if (!DATABASE_URL) return false
  const probe = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 })
  try {
    await probe.connect()
    const { rows } = await probe.query<{ ok: boolean }>(`SELECT to_regclass('rbmc_stations') IS NOT NULL AS ok`)
    await probe.end()
    return rows[0]?.ok === true
  } catch {
    return false
  }
}

const dbReady = await checkDbReady()
const client = new pg.Client({ connectionString: DATABASE_URL! })

const RUN = `ITG${Date.now().toString(36).slice(-1).toUpperCase()}`
// Codes that cannot collide with real IBGE stations (they contain a digit-first pattern IBGE never uses).
const CODE_A = `9${RUN.slice(0, 3)}`
const CODE_B = `8${RUN.slice(0, 3)}`
const CODE_C = `7${RUN.slice(0, 3)}`

function st(code: string, lat = -20, lon = -42): RbmcStationInput {
  return { code, station_id: null, uf: 'ZZ', geocodigo: null, lat, lon, alt_geom: null }
}

beforeAll(async () => {
  if (!dbReady) return
  await client.connect()
  await client.query('BEGIN')
})

afterAll(async () => {
  if (!dbReady) return
  await client.query('ROLLBACK')
  await client.end()
})

describe.skipIf(!dbReady)('rbmc sync integration (rolled back)', () => {
  it('adopts, creates, links and disables in one transaction, then is idempotent', async () => {
    // Seed hand-made tests for station A only (0 + 1 siblings), nothing for B.
    await client.query(
      `INSERT INTO tests (id, name, code, schedule_ms, timeout_ms, retries, uses_browser, enabled, tags)
       VALUES ($1, $2, 'return true', 900000, 10000, 1, false, true, '{rbmc}'),
              ($3, $4, 'return true', 900000, 10000, 1, false, true, '{rbmc}')`,
      [`${RUN}-a0`, `RBMC - ${CODE_A}0 - Alpha City`, `${RUN}-a1`, `RBMC - ${CODE_A}1 - Alpha City`]
    )

    const first = await applyStations(client, [st(CODE_A), st(CODE_B, -10, -50)], (c) => (c === CODE_B ? 'Beta City' : null))
    expect(first.plan.adoptions.map((a) => a.id)).toEqual([`${RUN}-a0`])
    expect(first.disabled.map((t) => t.id)).toEqual([`${RUN}-a1`])
    expect(first.created).toHaveLength(1)
    expect(first.created[0]!.name).toBe(`RBMC - ${CODE_B} - Beta City`)
    expect(first.created[0]!.tags).toEqual(['rbmc'])
    expect(first.created[0]!.failure_threshold).toBe(3)

    const { rows: stations } = await client.query<{ code: string; test_id: string | null; name: string | null; in_shapefile: boolean; template_version: number | null }>(
      `SELECT code, test_id, name, in_shapefile, template_version FROM rbmc_stations WHERE code = ANY($1) ORDER BY code`,
      [[CODE_A, CODE_B, CODE_C]]
    )
    expect(stations).toEqual([
      { code: CODE_B, test_id: first.created[0]!.id, name: 'Beta City', in_shapefile: true, template_version: RBMC_TEMPLATE_VERSION },
      { code: CODE_A, test_id: `${RUN}-a0`, name: 'Alpha City', in_shapefile: true, template_version: RBMC_TEMPLATE_VERSION },
    ])
    const { rows: adopted } = await client.query<{ name: string; code: string; enabled: boolean }>(
      `SELECT name, code, enabled FROM tests WHERE id = $1`, [`${RUN}-a0`]
    )
    expect(adopted[0]).toEqual({ name: `RBMC - ${CODE_A} - Alpha City`, code: buildStationTestCode(CODE_A), enabled: true })

    // Second run with the same shapefile: nothing changes.
    const second = await applyStations(client, [st(CODE_A), st(CODE_B, -10, -50)], () => null)
    expect(second.plan.unchanged).toBe(2)
    expect(second.created).toEqual([])
    expect(second.updated).toEqual([])
    expect(second.disabled).toEqual([])

    // Station A removed from the shapefile, station C added: A's test is disabled (not deleted), C created.
    const third = await applyStations(client, [st(CODE_B, -10, -50), st(CODE_C, -5, -60)], () => null)
    expect(third.disabled.map((t) => t.id)).toEqual([`${RUN}-a0`])
    expect(third.created.map((t) => t.name)).toEqual([`RBMC - ${CODE_C} - ${CODE_C}`])
    const { rows: after } = await client.query<{ code: string; in_shapefile: boolean }>(
      `SELECT code, in_shapefile FROM rbmc_stations WHERE code = ANY($1) ORDER BY code`, [[CODE_A, CODE_B, CODE_C]]
    )
    expect(after.find((r) => r.code === CODE_A)!.in_shapefile).toBe(false)
    expect(after.find((r) => r.code === CODE_C)!.in_shapefile).toBe(true)
    const { rows: aTest } = await client.query<{ enabled: boolean }>(`SELECT enabled FROM tests WHERE id = $1`, [`${RUN}-a0`])
    expect(aTest[0]!.enabled).toBe(false)
  })
})
