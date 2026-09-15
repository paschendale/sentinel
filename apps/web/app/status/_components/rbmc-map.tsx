'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import type { ErrorEvent, GeoJSONSource, MapLayerMouseEvent, MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { PublicStatusOutcome, RbmcMapCollection, RbmcMapFeatureProperties } from '@sentinel/shared'

/** CARTO Dark Matter — free, keyless, MapLibre-ready. Override with NEXT_PUBLIC_MAP_STYLE_URL. */
const DEFAULT_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || DEFAULT_STYLE_URL

/** Used when the remote style cannot be loaded: plain dark ground, stations still drawn. */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#09090b' } }],
}

/** Brazil, with a little slack for the offshore/Uruguayan stations. */
const BRAZIL_BOUNDS: [[number, number], [number, number]] = [[-75, -35], [-33, 6]]

const SOURCE_ID = 'rbmc-stations'
const LAYER_ID = 'rbmc-stations-circle'
const HALO_ID = 'rbmc-stations-halo'

const STATUS_COLOR: Record<PublicStatusOutcome, string> = {
  up: '#34d399',       // emerald-400
  degraded: '#facc15', // yellow-400
  down: '#f87171',     // red-400
  unknown: '#71717a',  // zinc-500
}

const STATUS_LABEL: Record<PublicStatusOutcome, string> = {
  up: 'up',
  degraded: 'degraded',
  down: 'down',
  unknown: 'unknown',
}

const STATUS_ORDER: PublicStatusOutcome[] = ['up', 'degraded', 'down', 'unknown']

interface Props {
  initial: RbmcMapCollection
  /** Public GeoJSON endpoint polled every `refreshMs`. */
  refreshUrl: string
  refreshMs?: number
  /** Where a station's test detail lives for this audience. */
  linkBase: '/status/tests' | '/tests'
  className?: string
}

function countByStatus(fc: RbmcMapCollection): Record<PublicStatusOutcome, number> {
  const counts: Record<PublicStatusOutcome, number> = { up: 0, degraded: 0, down: 0, unknown: 0 }
  for (const f of fc.features) counts[f.properties.status]++
  return counts
}

function addStationLayers(map: MapLibreMap, data: RbmcMapCollection): void {
  if (map.getSource(SOURCE_ID)) return
  map.addSource(SOURCE_ID, { type: 'geojson', data })
  map.addLayer({
    id: HALO_ID,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 9, 8, 16],
      'circle-color': ['match', ['get', 'status'], 'up', STATUS_COLOR.up, 'degraded', STATUS_COLOR.degraded, 'down', STATUS_COLOR.down, STATUS_COLOR.unknown],
      'circle-opacity': ['match', ['get', 'status'], 'down', 0.28, 'degraded', 0.22, 0.12],
    },
  })
  map.addLayer({
    id: LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4.5, 8, 8],
      'circle-color': ['match', ['get', 'status'], 'up', STATUS_COLOR.up, 'degraded', STATUS_COLOR.degraded, 'down', STATUS_COLOR.down, STATUS_COLOR.unknown],
      // Shape + colour: disabled/unknown stations get a dashed-looking dim ring instead of a solid dot.
      'circle-stroke-width': ['case', ['get', 'enabled'], 1, 2],
      'circle-stroke-color': ['case', ['get', 'enabled'], '#09090b', '#3f3f46'],
      'circle-opacity': ['case', ['get', 'enabled'], 1, 0.55],
    },
  })
}

export function RbmcMap({ initial, refreshUrl, refreshMs = 300_000, linkBase, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const dataRef = useRef<RbmcMapCollection>(initial)
  const [data, setData] = useState<RbmcMapCollection>(initial)
  const [selected, setSelected] = useState<RbmcMapFeatureProperties | null>(null)
  const [fallback, setFallback] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const counts = useMemo(() => countByStatus(data), [data])

  // Map lifecycle — created once; data updates go through setData on the source.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new MapLibreMap({
      container,
      style: STYLE_URL,
      bounds: BRAZIL_BOUNDS,
      fitBoundsOptions: { padding: 32 },
      attributionControl: { compact: true },
      cooperativeGestures: false,
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    let usingFallback = false
    map.on('style.load', () => addStationLayers(map, dataRef.current))
    map.on('error', (e: ErrorEvent) => {
      // Any error before the first style finished loading means the remote style is unreachable.
      if (usingFallback || map.isStyleLoaded()) return
      usingFallback = true
      setFallback(true)
      console.warn('[rbmc-map] style failed to load, using plain dark fallback', e.error?.message)
      map.setStyle(FALLBACK_STYLE)
    })

    const onClick = (e: MapLayerMouseEvent) => {
      const code = e.features?.[0]?.properties?.['code']
      if (typeof code !== 'string') return
      const feature = dataRef.current.features.find((f) => f.properties.code === code)
      setSelected(feature ? feature.properties : null)
    }
    map.on('click', LAYER_ID, onClick)
    map.on('click', (e: MapMouseEvent) => {
      const hits = map.getLayer(LAYER_ID) ? map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] }) : []
      if (hits.length === 0) setSelected(null)
    })
    map.on('mouseenter', LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', LAYER_ID, () => { map.getCanvas().style.cursor = '' })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Push new data into the existing source without recreating the map.
  useEffect(() => {
    dataRef.current = data
    const map = mapRef.current
    const source = map?.getSource(SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(data)
    setSelected((prev) => (prev ? data.features.find((f) => f.properties.code === prev.code)?.properties ?? null : null))
  }, [data])

  // Periodic refresh from the public aggregated endpoint.
  useEffect(() => {
    let cancelled = false
    const id = setInterval(() => {
      fetch(refreshUrl)
        .then((r) => (r.ok ? (r.json() as Promise<RbmcMapCollection>) : Promise.reject(new Error(String(r.status)))))
        .then((fc) => {
          if (cancelled || fc?.type !== 'FeatureCollection') return
          setData(fc)
          setUpdatedAt(new Date())
        })
        .catch(() => {})
    }, refreshMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [refreshUrl, refreshMs])

  return (
    <div className={`relative w-full overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-950 ${className ?? 'h-[72vh] min-h-[420px]'}`}>
      <div ref={containerRef} className="absolute inset-0" />

      {/* Legend + counts */}
      <div className="absolute left-3 top-3 z-10 rounded-md border border-zinc-800/80 bg-zinc-950/85 px-3 py-2 text-xs backdrop-blur-sm">
        <div className="mb-1.5 text-zinc-400">
          {data.features.length} RBMC stations
        </div>
        <ul className="space-y-1">
          {STATUS_ORDER.map((s) => (
            <li key={s} className="flex items-center gap-2 tabular-nums">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLOR[s] }} aria-hidden />
              <span className="w-16 text-zinc-300">{STATUS_LABEL[s]}</span>
              <span className="text-zinc-100">{counts[s]}</span>
            </li>
          ))}
        </ul>
        {(updatedAt || fallback) && (
          <div className="mt-1.5 text-[10px] text-zinc-600">
            {updatedAt ? `refreshed ${updatedAt.toLocaleTimeString()}` : null}
            {updatedAt && fallback ? ' · ' : null}
            {fallback ? 'basemap unavailable' : null}
          </div>
        )}
      </div>

      {/* Selected station panel — rendered by React, never innerHTML (caster text is untrusted). */}
      {selected && (
        <div className="absolute bottom-3 left-3 z-10 w-72 max-w-[calc(100%-1.5rem)] rounded-md border border-zinc-800/80 bg-zinc-950/90 px-4 py-3 text-sm backdrop-blur-sm">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLOR[selected.status] }} aria-hidden />
                <span className="font-medium text-zinc-100">{selected.code}</span>
                <span className="text-xs uppercase tracking-wide text-zinc-500">{STATUS_LABEL[selected.status]}</span>
              </div>
              <div className="mt-0.5 truncate text-zinc-400">
                {selected.name ?? '—'}{selected.uf ? ` · ${selected.uf}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-zinc-600 hover:text-zinc-300 transition-colors"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">30-day uptime</dt>
              <dd className="tabular-nums text-zinc-200">{selected.uptime_pct_30d === null ? '—' : `${selected.uptime_pct_30d}%`}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">monitoring</dt>
              <dd className="text-zinc-200">{selected.enabled ? 'enabled' : 'disabled'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">mountpoints</dt>
              <dd className="text-right text-zinc-200">
                {selected.mountpoints === undefined
                  ? <span className="text-zinc-600">not cached yet</span>
                  : selected.mountpoints.length === 0
                    ? <span className="text-red-400/90">none listed</span>
                    : selected.mountpoints.map((m) => (
                        <div key={m.mountpoint} className="tabular-nums">{m.mountpoint} <span className="text-zinc-500">{m.format}</span></div>
                      ))}
              </dd>
            </div>
          </dl>
          {selected.test_id && (
            <a
              href={`${linkBase}/${encodeURIComponent(selected.test_id)}`}
              className="mt-3 inline-block text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              history →
            </a>
          )}
        </div>
      )}
    </div>
  )
}
