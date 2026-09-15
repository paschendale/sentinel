import type { ClientBase } from 'pg'
import type { RbmcStation, RbmcStationSummary, Test } from '@sentinel/shared'
import { pool } from '../pool.js'

/** A station as read from the shapefile — everything except the test link. */
export interface RbmcStationInput {
  code: string
  station_id: string | null
  uf: string | null
  geocodigo: string | null
  lat: number
  lon: number
  alt_geom: string | null
}

export interface RbmcStationWithTest extends RbmcStation {
  test_exists: boolean
  test_name: string | null
  test_code: string | null
  test_enabled: boolean | null
}

export interface CandidateTest {
  id: string
  name: string
  code: string
  enabled: boolean
  created_at: Date
}

export interface NewTestRow {
  id: string
  name: string
  code: string
  schedule_ms: number
  timeout_ms: number
  retries: number
  uses_browser: boolean
  enabled: boolean
  tags: string[]
  failure_threshold: number
  cooldown_ms: number
}

/** Builds `($1,$2,…),($n,…)` placeholders for a multi-row VALUES clause. */
function valuesClause(rowCount: number, colCount: number): string {
  const rows: string[] = []
  for (let r = 0; r < rowCount; r++) {
    const cols: string[] = []
    for (let c = 0; c < colCount; c++) cols.push(`$${r * colCount + c + 1}`)
    rows.push(`(${cols.join(', ')})`)
  }
  return rows.join(', ')
}

/** Single multi-row upsert (RULES #8 — never insert in a loop). Marks every row as present in the shapefile. */
export async function upsertStations(client: ClientBase, rows: RbmcStationInput[]): Promise<void> {
  if (rows.length === 0) return
  const params: unknown[] = []
  for (const r of rows) {
    params.push(r.code, r.station_id, r.uf, r.geocodigo, r.lat, r.lon, r.alt_geom)
  }
  await client.query(
    `INSERT INTO rbmc_stations (code, station_id, uf, geocodigo, lat, lon, alt_geom)
     VALUES ${valuesClause(rows.length, 7)}
     ON CONFLICT (code) DO UPDATE SET
       station_id = EXCLUDED.station_id,
       uf = EXCLUDED.uf,
       geocodigo = EXCLUDED.geocodigo,
       lat = EXCLUDED.lat,
       lon = EXCLUDED.lon,
       alt_geom = EXCLUDED.alt_geom,
       in_shapefile = TRUE,
       synced_at = NOW()`,
    params
  )
}

/** Stations previously flagged as missing that are back in this shapefile — their tests get re-enabled. */
export async function findReturningStations(
  client: ClientBase,
  presentCodes: string[]
): Promise<Array<{ code: string; test_id: string | null }>> {
  const { rows } = await client.query<{ code: string; test_id: string | null }>(
    `SELECT code, test_id FROM rbmc_stations
     WHERE in_shapefile = FALSE AND code = ANY($1::text[])`,
    [presentCodes]
  )
  return rows
}

/** Flags stations that are no longer in the shapefile. Returns the rows that just flipped. */
export async function markMissingStations(
  client: ClientBase,
  presentCodes: string[]
): Promise<Array<{ code: string; test_id: string | null }>> {
  const { rows } = await client.query<{ code: string; test_id: string | null }>(
    `UPDATE rbmc_stations
     SET in_shapefile = FALSE, synced_at = NOW()
     WHERE in_shapefile = TRUE AND code <> ALL($1::text[])
     RETURNING code, test_id`,
    [presentCodes]
  )
  return rows
}

export async function listStationsWithTests(client: ClientBase): Promise<RbmcStationWithTest[]> {
  const { rows } = await client.query<RbmcStationWithTest>(
    `SELECT s.*,
            (t.id IS NOT NULL) AS test_exists,
            t.name AS test_name,
            t.code AS test_code,
            t.enabled AS test_enabled
     FROM rbmc_stations s
     LEFT JOIN tests t ON t.id = s.test_id
     ORDER BY s.code`
  )
  return rows
}

/** Adoption pool: every test that looks like a hand-made or generated RBMC station test. */
export async function findRbmcCandidateTests(client: ClientBase): Promise<CandidateTest[]> {
  const { rows } = await client.query<CandidateTest>(
    `SELECT id, name, code, enabled, created_at
     FROM tests
     WHERE name ~ '^RBMC - [A-Z0-9]{4}[0-9]? - '
     ORDER BY created_at ASC`
  )
  return rows
}

export async function insertTests(client: ClientBase, rows: NewTestRow[]): Promise<Test[]> {
  if (rows.length === 0) return []
  const params: unknown[] = []
  for (const r of rows) {
    params.push(
      r.id, r.name, r.code, r.schedule_ms, r.timeout_ms, r.retries, r.uses_browser,
      r.enabled, r.tags, r.failure_threshold, r.cooldown_ms
    )
  }
  const { rows: created } = await client.query<Test>(
    `INSERT INTO tests (id, name, code, schedule_ms, timeout_ms, retries, uses_browser, enabled, tags, failure_threshold, cooldown_ms)
     VALUES ${valuesClause(rows.length, 11)}
     RETURNING *`,
    params
  )
  return created
}

export async function updateTestsNameAndCode(
  client: ClientBase,
  rows: Array<{ id: string; name: string; code: string }>
): Promise<Test[]> {
  if (rows.length === 0) return []
  const params: unknown[] = []
  for (const r of rows) params.push(r.id, r.name, r.code)
  const { rows: updated } = await client.query<Test>(
    `UPDATE tests AS t
     SET name = v.name, code = v.code, updated_at = NOW()
     FROM (VALUES ${valuesClause(rows.length, 3)}) AS v(id, name, code)
     WHERE t.id = v.id
     RETURNING t.*`,
    params
  )
  return updated
}

export async function disableTests(client: ClientBase, ids: string[]): Promise<Test[]> {
  if (ids.length === 0) return []
  const { rows } = await client.query<Test>(
    `UPDATE tests SET enabled = FALSE, updated_at = NOW()
     WHERE id = ANY($1::text[]) AND enabled = TRUE
     RETURNING *`,
    [ids]
  )
  return rows
}

export async function enableTests(client: ClientBase, ids: string[]): Promise<Test[]> {
  if (ids.length === 0) return []
  const { rows } = await client.query<Test>(
    `UPDATE tests SET enabled = TRUE, updated_at = NOW()
     WHERE id = ANY($1::text[]) AND enabled = FALSE
     RETURNING *`,
    [ids]
  )
  return rows
}

export async function linkStations(
  client: ClientBase,
  rows: Array<{ code: string; test_id: string; name: string | null; template_version: number }>
): Promise<void> {
  if (rows.length === 0) return
  const params: unknown[] = []
  for (const r of rows) params.push(r.code, r.test_id, r.name, r.template_version)
  await client.query(
    `UPDATE rbmc_stations AS s
     SET test_id = v.test_id, name = COALESCE(v.name, s.name), template_version = v.template_version::int
     FROM (VALUES ${valuesClause(rows.length, 4)}) AS v(code, test_id, name, template_version)
     WHERE s.code = v.code`,
    params
  )
}

/** Admin listing (JWT-protected route + MCP `list_rbmc_stations`). */
export async function listStations(): Promise<RbmcStationSummary[]> {
  const { rows } = await pool.query<RbmcStationSummary>(
    `SELECT s.*,
            t.name AS test_name,
            t.enabled AS test_enabled,
            ts.last_status,
            ts.last_run_at
     FROM rbmc_stations s
     LEFT JOIN tests t ON t.id = s.test_id
     LEFT JOIN test_state ts ON ts.test_id = s.test_id
     ORDER BY s.code`
  )
  return rows
}

export interface RbmcMapRow {
  code: string
  name: string | null
  uf: string | null
  lat: number
  lon: number
  test_id: string | null
  enabled: boolean | null
  public_status: string
  uptime_pct_30d: number | null
}

/** Public map data — aggregated tables only (RULES #10: never `test_runs` on a public route). */
export async function listStationsForMap(): Promise<RbmcMapRow[]> {
  const { rows } = await pool.query<RbmcMapRow>(
    `SELECT s.code, s.name, s.uf, s.lat, s.lon, s.test_id, t.enabled,
            COALESCE(ts.public_status, 'unknown') AS public_status,
            ROUND(100.0 * SUM(ud.success_count)::numeric
                  / NULLIF(SUM(ud.success_count) + SUM(ud.failure_count), 0))::integer AS uptime_pct_30d
     FROM rbmc_stations s
     LEFT JOIN tests t ON t.id = s.test_id
     LEFT JOIN test_state ts ON ts.test_id = s.test_id
     LEFT JOIN uptime_daily ud
       ON ud.test_id = s.test_id AND ud.date >= (CURRENT_DATE - 29) AND ud.date <= CURRENT_DATE
     WHERE s.in_shapefile = TRUE AND s.lat IS NOT NULL AND s.lon IS NOT NULL
     GROUP BY s.code, s.name, s.uf, s.lat, s.lon, s.test_id, t.enabled, ts.public_status
     ORDER BY s.code`
  )
  return rows
}
