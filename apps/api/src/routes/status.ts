import type { FastifyInstance } from 'fastify'
import type { PublicStatusDay, PublicStatusTest, StatusBucket, StatusBucketTest, StatusPeriod } from '@sentinel/shared'
import { pool } from '../db/pool.js'

type TestRow = { id: string; name: string; enabled: boolean; tags: string[] }

type UdRow = {
  test_id: string
  date: string
  success_count: number
  failure_count: number
}

type StateRow = { test_id: string; public_status: string }

function dayOutcome(successCount: number, failureCount: number): PublicStatusDay['outcome'] {
  if (failureCount > 0 && successCount === 0) return 'down'
  if (failureCount > 0 && successCount > 0) return 'degraded'
  if (successCount > 0) return 'up'
  return 'unknown'
}

/** Last 30 UTC calendar days, oldest first. */
function utcDayStrings(): string[] {
  const out: string[] = []
  const now = new Date()
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  for (let i = 29; i >= 0; i--) {
    const t = end - i * 86_400_000
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

function buildPublicStatus(tests: TestRow[], udRows: UdRow[], stateRows: StateRow[]): PublicStatusTest[] {
  const dayStrings = utcDayStrings()
  const udByTest = new Map<string, Map<string, { s: number; f: number }>>()

  for (const row of udRows) {
    const d =
      typeof row.date === 'string'
        ? row.date.slice(0, 10)
        : (row.date as unknown as Date).toISOString().slice(0, 10)
    let m = udByTest.get(row.test_id)
    if (!m) {
      m = new Map()
      udByTest.set(row.test_id, m)
    }
    m.set(d, { s: Number(row.success_count), f: Number(row.failure_count) })
  }

  const stateMap = new Map(stateRows.map(s => [s.test_id, s]))

  return tests.map((t) => {
    const m = udByTest.get(t.id) ?? new Map()
    let totalS = 0
    let totalF = 0
    const days: PublicStatusDay[] = dayStrings.map((date) => {
      const cell = m.get(date)
      const s = cell?.s ?? 0
      const f = cell?.f ?? 0
      totalS += s
      totalF += f
      return { date, outcome: dayOutcome(s, f) }
    })

    const denom = totalS + totalF
    const uptime_pct_30d = denom === 0 ? null : Math.round((100 * totalS) / denom)

    const state = stateMap.get(t.id)
    const current_status = (state?.public_status ?? 'unknown') as PublicStatusTest['current_status']

    return {
      id: t.id,
      name: t.name,
      enabled: t.enabled,
      tags: t.tags,
      current_status,
      uptime_pct_30d,
      days,
    }
  })
}

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_req, reply) => {
    const { rows: tests } = await pool.query<TestRow>(
      `SELECT id, name, enabled, tags FROM tests ORDER BY created_at DESC`,
    )
    const { rows: udRows } = await pool.query<UdRow>(
      `SELECT test_id, date::text AS date, success_count, failure_count
       FROM uptime_daily
       WHERE date >= (CURRENT_DATE - 29)
         AND date <= CURRENT_DATE`,
    )
    const testIds = tests.map(t => t.id)
    const { rows: stateRows } = await pool.query<StateRow>(
      `SELECT test_id, public_status FROM test_state WHERE test_id = ANY($1)`,
      [testIds],
    )
    return reply.send(buildPublicStatus(tests, udRows, stateRows))
  })

  app.get<{ Params: { tag: string } }>('/tag/:tag', async (req, reply) => {
    const { tag } = req.params
    const { rows: tests } = await pool.query<TestRow>(
      `SELECT id, name, enabled, tags FROM tests WHERE $1 = ANY(tags) ORDER BY created_at DESC`,
      [tag],
    )
    if (tests.length === 0) return reply.status(404).send({ error: 'no tests found for this tag' })
    const testIds = tests.map(t => t.id)
    const { rows: udRows } = await pool.query<UdRow>(
      `SELECT test_id, date::text AS date, success_count, failure_count
       FROM uptime_daily
       WHERE test_id = ANY($1)
         AND date >= (CURRENT_DATE - 29)
         AND date <= CURRENT_DATE`,
      [testIds],
    )
    const { rows: stateRows } = await pool.query<StateRow>(
      `SELECT test_id, public_status FROM test_state WHERE test_id = ANY($1)`,
      [testIds],
    )
    return reply.send(buildPublicStatus(tests, udRows, stateRows))
  })

  app.get<{ Querystring: { period?: string; tag?: string } }>('/buckets', async (req, reply) => {
    const period = (req.query.period ?? '24h') as StatusPeriod
    const tag = req.query.tag as string | undefined

    if (!['1h', '24h', '7d', '30d'].includes(period)) {
      return reply.status(400).send({ error: 'invalid period' })
    }

    const testQuery = tag
      ? `SELECT id, name, enabled, tags FROM tests WHERE $1 = ANY(tags) ORDER BY created_at DESC`
      : `SELECT id, name, enabled, tags FROM tests ORDER BY created_at DESC`
    const { rows: tests } = await pool.query<TestRow>(tag ? testQuery : testQuery, tag ? [tag] : [])
    if (tests.length === 0) return reply.send([])

    const testIds = tests.map(t => t.id)

    if (period === '30d') {
      type DayBucketRow = {
        test_id: string
        date: string
        success_count: number
        failure_count: number
        avg_latency_ms: number | null
      }
      const { rows } = await pool.query<DayBucketRow>(
        `SELECT test_id, date::text AS date, success_count, failure_count, avg_latency_ms
         FROM uptime_daily
         WHERE test_id = ANY($1)
           AND date >= (CURRENT_DATE - 29)
           AND date <= CURRENT_DATE
         ORDER BY test_id, date`,
        [testIds],
      )

      // Build 30-day bucket arrays per test
      const now = new Date()
      const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      const dayStrings: string[] = []
      for (let i = 29; i >= 0; i--) {
        const t = todayUTC - i * 86_400_000
        dayStrings.push(new Date(t).toISOString().slice(0, 10))
      }

      const byTest = new Map<string, Map<string, { s: number; f: number; avg: number | null }>>()
      for (const r of rows) {
        const d = typeof r.date === 'string' ? r.date.slice(0, 10) : (r.date as unknown as Date).toISOString().slice(0, 10)
        let m = byTest.get(r.test_id)
        if (!m) { m = new Map(); byTest.set(r.test_id, m) }
        m.set(d, { s: Number(r.success_count), f: Number(r.failure_count), avg: r.avg_latency_ms !== null ? Number(r.avg_latency_ms) : null })
      }

      const result: StatusBucketTest[] = tests.map(t => ({
        id: t.id,
        name: t.name,
        enabled: t.enabled,
        tags: t.tags,
        buckets: dayStrings.map(date => {
          const cell = byTest.get(t.id)?.get(date)
          const bucketStart = new Date(date + 'T00:00:00Z').toISOString()
          const bucketEnd = new Date(new Date(date + 'T00:00:00Z').getTime() + 86_400_000).toISOString()
          return {
            bucket_start: bucketStart,
            bucket_end: bucketEnd,
            success_count: cell?.s ?? 0,
            failure_count: cell?.f ?? 0,
            avg_latency_ms: cell?.avg ?? null,
          } satisfies StatusBucket
        }),
      }))
      return reply.send(result)
    }

    // For 1h / 24h / 7d — use test_runs, 100 equal-width buckets
    const periodMs: Record<string, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 }
    const durationMs = periodMs[period]!
    const endTime = new Date()
    const startTime = new Date(endTime.getTime() - durationMs)
    const bucketSecs = durationMs / 1000 / 100

    type BucketRow = {
      test_id: string
      idx: number
      success_count: number
      failure_count: number
      avg_latency_ms: number | null
    }

    const { rows: bucketRows } = await pool.query<BucketRow>(
      `WITH
         all_buckets AS (SELECT generate_series(0, 99) AS idx),
         run_data AS (
           SELECT
             test_id,
             LEAST(FLOOR(EXTRACT(EPOCH FROM (started_at - $1::timestamptz)) / $2)::INT, 99) AS idx,
             COUNT(*) FILTER (WHERE status = 'success')  AS success_count,
             COUNT(*) FILTER (WHERE status != 'success') AS failure_count,
             AVG(duration_ms)                            AS avg_latency_ms
           FROM test_runs
           WHERE started_at >= $1 AND started_at < $3
             AND test_id = ANY($4)
           GROUP BY test_id, idx
         )
       SELECT
         t.id AS test_id,
         b.idx,
         COALESCE(r.success_count, 0) AS success_count,
         COALESCE(r.failure_count, 0) AS failure_count,
         r.avg_latency_ms
       FROM tests t
       CROSS JOIN all_buckets b
       LEFT JOIN run_data r ON r.test_id = t.id AND r.idx = b.idx
       WHERE t.id = ANY($4)
       ORDER BY t.id, b.idx`,
      [startTime.toISOString(), bucketSecs, endTime.toISOString(), testIds],
    )

    // Group by test
    const bucketsByTest = new Map<string, StatusBucket[]>()
    for (const row of bucketRows) {
      let arr = bucketsByTest.get(row.test_id)
      if (!arr) { arr = []; bucketsByTest.set(row.test_id, arr) }
      const idx = Number(row.idx)
      arr.push({
        bucket_start: new Date(startTime.getTime() + idx * bucketSecs * 1000).toISOString(),
        bucket_end: new Date(startTime.getTime() + (idx + 1) * bucketSecs * 1000).toISOString(),
        success_count: Number(row.success_count),
        failure_count: Number(row.failure_count),
        avg_latency_ms: row.avg_latency_ms !== null ? Number(row.avg_latency_ms) : null,
      })
    }

    const result: StatusBucketTest[] = tests.map(t => ({
      id: t.id,
      name: t.name,
      enabled: t.enabled,
      tags: t.tags,
      buckets: bucketsByTest.get(t.id) ?? [],
    }))
    return reply.send(result)
  })
}
