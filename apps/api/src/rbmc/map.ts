import type { PublicStatusOutcome, RbmcMapCollection, RbmcMapFeature, RbmcMountpoint } from '@sentinel/shared'
import type { RbmcMapRow } from '../db/queries/rbmc.js'
import type { NtripStreamRow } from '../executor/ntrip-sourcetable.js'

const OUTCOMES: ReadonlySet<string> = new Set(['up', 'degraded', 'down', 'unknown'])

/** Live mountpoints per station code, from a (warm) sourcetable. */
export function mountpointsByCode(rows: ReadonlyArray<NtripStreamRow> | null): Map<string, RbmcMountpoint[]> {
  const out = new Map<string, RbmcMountpoint[]>()
  if (!rows) return out
  for (const r of rows) {
    if (r.network !== 'RBMC-IP') continue
    const code = r.mountpoint.slice(0, 4)
    const list = out.get(code) ?? []
    list.push({ mountpoint: r.mountpoint, format: r.format })
    out.set(code, list)
  }
  for (const list of out.values()) list.sort((a, b) => a.mountpoint.localeCompare(b.mountpoint))
  return out
}

/** Public GeoJSON — aggregated data only; never test code or error messages. */
export function buildRbmcMapCollection(rows: RbmcMapRow[], live: Map<string, RbmcMountpoint[]>): RbmcMapCollection {
  const features: RbmcMapFeature[] = rows.map((r) => {
    const enabled = r.enabled === true
    const status: PublicStatusOutcome =
      enabled && OUTCOMES.has(r.public_status) ? (r.public_status as PublicStatusOutcome) : 'unknown'
    const mountpoints = live.get(r.code)
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(r.lon), Number(r.lat)] },
      properties: {
        code: r.code,
        name: r.name,
        uf: r.uf,
        test_id: r.test_id,
        status,
        enabled,
        uptime_pct_30d: r.uptime_pct_30d === null ? null : Number(r.uptime_pct_30d),
        ...(mountpoints ? { mountpoints } : {}),
      },
    }
  })
  return { type: 'FeatureCollection', features }
}
