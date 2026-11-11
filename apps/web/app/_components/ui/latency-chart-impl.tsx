'use client'

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { StatusBucket, StatusPeriod } from '@sentinel/shared'
import { KIND_LABELS } from '../../../lib/states'
import { PERIOD_START_LABELS, bucketKind, clockTime, dateTime, formatMs, shortDate } from '../../../lib/format'
import { useTimeZone } from './time-zone'

const Y_AXIS = 48
const RIGHT = 8

interface Point {
  i: number
  start: string
  ms: number | null
}

/** Runs of Degraded or Outage buckets, merged, for the event bars under the plot. */
function events(buckets: StatusBucket[]) {
  const out: Array<{ kind: 'degraded' | 'outage'; from: number; to: number; start: string }> = []
  buckets.forEach((b, i) => {
    const k = bucketKind(b)
    if (k !== 'degraded' && k !== 'outage') return
    const last = out[out.length - 1]
    if (last && last.kind === k && last.to === i - 1) last.to = i
    else out.push({ kind: k, from: i, to: i, start: b.bucket_start })
  })
  return out
}

export default function LatencyChartImpl({ buckets, period }: { buckets: StatusBucket[]; period: StatusPeriod }) {
  const { tz } = useTimeZone()
  const data: Point[] = buckets.map((b, i) => ({
    i,
    start: b.bucket_start,
    ms: b.success_count + b.warn_count + b.failure_count > 0 && b.avg_latency_ms !== null ? Math.round(b.avg_latency_ms) : null,
  }))
  const values = data.map((d) => d.ms).filter((v): v is number => v !== null)
  if (values.length === 0) return <div className="sn-latency__empty">No runs in this period.</div>
  const max = Math.max(...values)
  const top = niceCeil(max)
  const lastIdx = data.reduce((acc, d) => (d.ms !== null ? d.i : acc), -1)
  const evts = events(buckets)
  const n = Math.max(1, buckets.length - 1)
  const at = (i: number) => `calc(${Y_AXIS}px + (100% - ${Y_AXIS + RIGHT}px) * ${i / n})`
  const latest = evts[evts.length - 1]
  const label = (iso: string) => (period === '30d' ? shortDate(iso, tz) : period === '7d' ? dateTime(iso, tz) : clockTime(iso, tz).replace(' UTC', ''))

  return (
    <div className="sn-latency" role="img" aria-label={`Response time over the last ${period}, between ${formatMs(Math.min(...values))} and ${formatMs(max)}`}>
      <div className="sn-latency__plot">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: RIGHT, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="i" hide type="number" domain={[0, n]} />
            <YAxis
              width={Y_AXIS}
              domain={[0, top]}
              ticks={[0, top / 2, top]}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => (v === 0 ? '0 ms' : v.toLocaleString('en-US'))}
            />
            <Tooltip
              isAnimationActive={false}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as Point | undefined
                if (!active || !p) return null
                return (
                  <div className="sn-chart-tip">
                    <b>{dateTime(p.start, tz)}</b>
                    {p.ms === null ? 'No runs' : `avg ${formatMs(p.ms)}`}
                  </div>
                )
              }}
            />
            <Area dataKey="ms" type="monotone" isAnimationActive={false} connectNulls activeDot={false} />
            <Line
              dataKey="ms"
              type="monotone"
              isAnimationActive={false}
              connectNulls
              dot={(props: { cx?: number; cy?: number; index?: number }) =>
                props.index === lastIdx && props.cx !== undefined && props.cy !== undefined ? (
                  <circle key="end" className="sn-latency__end" cx={props.cx} cy={props.cy} r={3.5} />
                ) : (
                  <g key={props.index} />
                )
              }
              activeDot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="sn-latency__events" aria-hidden="true">
        {evts.map((e) => (
          <span
            key={`${e.kind}-${e.from}`}
            className={`sn-latency__evt sn-latency__evt--${e.kind}`}
            style={{ left: at(e.from), width: `max(3px, calc((100% - ${Y_AXIS + RIGHT}px) * ${(e.to - e.from + 1) / (n + 1)}))` }}
            title={`${KIND_LABELS[e.kind]} from ${dateTime(e.start, tz)}`}
          />
        ))}
      </div>
      <div className="sn-latency__labels">
        <span style={{ left: Y_AXIS }}>{PERIOD_START_LABELS[period]}</span>
        {latest && latest.from / n > 0.18 && latest.from / n < 0.8 && (
          <span style={{ left: at(latest.from) }}>
            {KIND_LABELS[latest.kind]} {label(latest.start)}
          </span>
        )}
        <span style={{ right: RIGHT }}>now</span>
      </div>
    </div>
  )
}

/** A round axis maximum: 1, 2 or 5 times a power of ten, at or above `v`. */
function niceCeil(v: number): number {
  if (v <= 0) return 100
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}
