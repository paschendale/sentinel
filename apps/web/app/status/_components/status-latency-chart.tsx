'use client'

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { StatusBucket, StatusPeriod } from '@sentinel/shared'

interface Props {
  buckets: StatusBucket[]
  period: StatusPeriod
}

function formatLabel(iso: string, period: StatusPeriod): string {
  const d = new Date(iso)
  if (period === '30d') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (period === '7d')  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: period === '1h' ? '2-digit' : undefined })
}

type ChartPoint = {
  idx: number
  label: string
  avg_ms: number | null
  failure_ms: number | null
}

function buildData(buckets: StatusBucket[], period: StatusPeriod): ChartPoint[] {
  return buckets.map((b, i) => {
    const hasData = b.success_count + b.failure_count > 0
    return {
      idx: i,
      label: formatLabel(b.bucket_start, period),
      avg_ms: hasData && b.avg_latency_ms !== null ? Math.round(b.avg_latency_ms) : null,
      failure_ms: b.failure_count > 0 && b.avg_latency_ms !== null ? Math.round(b.avg_latency_ms) : null,
    }
  })
}

export function StatusLatencyChart({ buckets, period }: Props) {
  const data = buildData(buckets, period)
  const hasAnyData = data.some(d => d.avg_ms !== null)

  if (!hasAnyData) {
    return (
      <div className="h-48 flex items-center justify-center text-zinc-500 text-sm border border-zinc-800/80 rounded-lg bg-zinc-900/30">
        No data for this period.
      </div>
    )
  }

  const maxMs = Math.max(...data.map(d => d.avg_ms ?? 0), 1)
  const tickInterval = Math.max(1, Math.floor(data.length / 8))

  return (
    <div className="h-48 w-full border border-zinc-800/80 rounded-lg bg-zinc-900/30 px-1 py-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#71717a', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#3f3f46' }}
            interval={tickInterval}
          />
          <YAxis
            tick={{ fill: '#71717a', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#3f3f46' }}
            domain={[0, Math.ceil(maxMs * 1.2)]}
            width={52}
            tickFormatter={v => `${v}ms`}
          />
          <Tooltip
            cursor={{ stroke: '#52525b', strokeWidth: 1 }}
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: 4,
              fontSize: 11,
              color: '#e4e4e7',
              fontFamily: 'Consolas, ui-monospace, monospace',
            }}
            formatter={(value, name) => {
              if (name === 'avg_ms' && value != null) return [`${value}ms`, 'Avg latency']
              if (name === 'failure_ms' && value != null) return [`${value}ms`, 'Failure']
              return null
            }}
          />
          <Bar
            dataKey="failure_ms"
            fill="#ef4444"
            barSize={6}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="avg_ms"
            stroke="#a1a1aa"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: '#d4d4d8', strokeWidth: 0 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
