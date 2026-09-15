import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../auth/jwt.js', () => ({
  verifyJwt: vi.fn(() => ({ sub: 'admin' })),
  signJwt: vi.fn(() => 'signed-token'),
}))

const { syncMock } = vi.hoisted(() => ({ syncMock: vi.fn() }))
vi.mock('../rbmc/sync.js', () => ({
  syncRbmcStations: syncMock,
  startRbmcSync: vi.fn(),
  stopRbmcSync: vi.fn(),
}))

import { pool } from '../db/pool.js'
import { verifyJwt } from '../auth/jwt.js'
import { buildServer } from '../server.js'
import { ntripSourcetableCache } from '../executor/ctx.js'

const mockQuery = vi.mocked(pool.query)
const mockVerify = vi.mocked(verifyJwt)

const AUTH = { authorization: 'Bearer test-token' }

function mapRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    code: 'VICO',
    name: 'Vicosa',
    uf: 'MG',
    lat: -20.76,
    lon: -42.87,
    test_id: 't-vico',
    enabled: true,
    public_status: 'up',
    uptime_pct_30d: 99,
    ...overrides,
  }
}

describe('rbmc routes', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockVerify.mockReset().mockReturnValue({ sub: 'admin' })
    syncMock.mockReset()
    ntripSourcetableCache.clear()
  })

  it('GET /rbmc requires auth', async () => {
    mockVerify.mockReturnValue(null)
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/rbmc' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /rbmc returns the station listing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'VICO', test_id: 't-vico', last_status: 'success' }] } as never)
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/rbmc', headers: AUTH })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual([{ code: 'VICO', test_id: 't-vico', last_status: 'success' }])
  })

  it('POST /rbmc/sync returns 200 on success and 503 when the sync reports failure', async () => {
    syncMock.mockResolvedValueOnce({ ok: true, reason: 'manual', stations: 157, created: 0, adopted: 0, updated: 0, disabled: 0, skipped: 0 })
    const app = await buildServer()
    const ok = await app.inject({ method: 'POST', url: '/rbmc/sync', headers: AUTH })
    expect(ok.statusCode).toBe(200)
    expect(JSON.parse(ok.body)).toMatchObject({ ok: true, stations: 157 })
    expect(syncMock).toHaveBeenCalledWith({ reason: 'manual' })

    syncMock.mockResolvedValueOnce({ ok: false, reason: 'manual', stations: 0, created: 0, adopted: 0, updated: 0, disabled: 0, skipped: 0, error: 'ENOENT' })
    const bad = await app.inject({ method: 'POST', url: '/rbmc/sync', headers: AUTH })
    expect(bad.statusCode).toBe(503)
    expect(JSON.parse(bad.body).error).toBe('ENOENT')
  })

  it('GET /status/rbmc/map is public and returns aggregated GeoJSON only', async () => {
    mockVerify.mockReturnValue(null)
    mockQuery.mockResolvedValueOnce({
      rows: [
        mapRow(),
        mapRow({ code: 'AMCO', name: null, test_id: 't-amco', public_status: 'down', uptime_pct_30d: 0 }),
        mapRow({ code: 'GONE', test_id: 't-gone', enabled: false, public_status: 'up' }),
        mapRow({ code: 'NEWW', test_id: null, enabled: null, public_status: 'unknown', uptime_pct_30d: null }),
      ],
    } as never)
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/status/rbmc/map' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=60')
    const body = JSON.parse(res.body)
    expect(body.type).toBe('FeatureCollection')
    expect(body.features).toHaveLength(4)
    expect(body.features[0]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-42.87, -20.76] },
      properties: { code: 'VICO', name: 'Vicosa', uf: 'MG', test_id: 't-vico', status: 'up', enabled: true, uptime_pct_30d: 99 },
    })
    expect(body.features[1].properties.status).toBe('down')
    // Disabled test → unknown regardless of stored public_status; cold cache → no mountpoints key.
    expect(body.features[2].properties).toMatchObject({ status: 'unknown', enabled: false })
    expect(body.features[3].properties).toMatchObject({ status: 'unknown', enabled: false, uptime_pct_30d: null })
    expect(res.body).not.toContain('mountpoints')
    expect(res.body).not.toContain('error_message')
  })

  it('map builder attaches live RBMC-IP mountpoints per station and ignores other networks', async () => {
    const table = [
      'STR;VICO1;Vicosa;RTCM 3.0;1004(1);2;GPS+GLO;RBMC-IP;BRA;-20.76;-42.87;0;0;TRIMBLE NETR9;none;B;N;1500;RBMC',
      'STR;VICO0;Vicosa;RTCM 3.2;1077(1);2;GPS+GLO+GAL;RBMC-IP;BRA;-20.76;-42.87;0;0;TRIMBLE NETR9;none;B;N;1500;RBMC',
      'STR;SSRA03IGS0;RTCM-SSR APC;RTCM 3.1;1057(60);0;GPS;IGS;DEU;50.09;8.66;0;1;BNC;none;B;N;800;IGS',
      'ENDSOURCETABLE',
    ].join('\r\n')
    const { mountpointsByCode, buildRbmcMapCollection } = await import('../rbmc/map.js')
    const { parseSourcetable } = await import('../executor/ntrip-sourcetable.js')
    const live = mountpointsByCode(parseSourcetable(table))
    expect(live.get('VICO')).toEqual([
      { mountpoint: 'VICO0', format: 'RTCM 3.2' },
      { mountpoint: 'VICO1', format: 'RTCM 3.0' },
    ])
    expect(live.has('SSRA')).toBe(false)
    const fc = buildRbmcMapCollection([mapRow() as never], live)
    expect(fc.features[0]!.properties.mountpoints).toHaveLength(2)
  })
})
