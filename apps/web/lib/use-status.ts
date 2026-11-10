'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StatusBucket, StatusPeriod } from '@sentinel/shared'
import { API_URL } from './auth-client'

/** Polls the page every 60 s: the server data through router.refresh, the history here. */
export function useAutoRefresh(): number {
  const router = useRouter()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      router.refresh()
      setTick((k) => k + 1)
    }, 60_000)
    return () => clearInterval(id)
  }, [router])
  return tick
}

/** History buckets for every check (or one) in the period, keyed by test id; null while loading. */
export function useBuckets(period: StatusPeriod, opts: { tag?: string; testId?: string }, tick: number): Map<string, StatusBucket[]> | null {
  const [data, setData] = useState<Map<string, StatusBucket[]> | null>(null)
  useEffect(() => {
    let live = true
    setData(null)
    const params = new URLSearchParams({ period })
    if (opts.tag) params.set('tag', opts.tag)
    if (opts.testId) params.set('testId', opts.testId)
    fetch(`${API_URL}/status/buckets?${params}`)
      .then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; buckets: StatusBucket[] }>>) : []))
      .then((rows) => {
        if (live) setData(new Map(rows.map((r) => [r.id, r.buckets])))
      })
      .catch(() => {
        if (live) setData(new Map())
      })
    return () => {
      live = false
    }
  }, [period, opts.tag, opts.testId, tick])
  return data
}
