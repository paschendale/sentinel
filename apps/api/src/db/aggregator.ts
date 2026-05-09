import { AGG_RETENTION_DAYS, PRUNE_BATCH_SIZE, RAW_RETENTION_DAYS } from '../config.js'
import { logger } from '../logger.js'
import { pool } from './pool.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const FUTURE_PARTITIONS_TO_CREATE = 2

let timeoutHandle: ReturnType<typeof setTimeout> | null = null
let intervalHandle: ReturnType<typeof setInterval> | null = null

function msUntilMidnightUTC(): number {
  const now = new Date()
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return midnight.getTime() - now.getTime()
}

export function startAggregator(): void {
  void runAggregation()
  timeoutHandle = setTimeout(() => {
    void runAggregation()
    intervalHandle = setInterval(() => {
      void runAggregation()
    }, MS_PER_DAY)
  }, msUntilMidnightUTC())
  logger.info({ event: 'aggregator.scheduled' }, 'aggregator scheduled to run at next UTC midnight')
}

export function stopAggregator(): void {
  if (timeoutHandle !== null) {
    clearTimeout(timeoutHandle)
    timeoutHandle = null
  }
  if (intervalHandle !== null) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}

export async function runAggregation(): Promise<void> {
  const runStartedAt = Date.now()
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const yesterday = new Date(today.getTime() - MS_PER_DAY)
  const tomorrow = new Date(today.getTime() + MS_PER_DAY)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)
  const rawCutoffIso = new Date(now.getTime() - RAW_RETENTION_DAYS * MS_PER_DAY).toISOString()

  try {
    await pool.query(
      `INSERT INTO uptime_daily (test_id, date, success_count, failure_count, avg_latency_ms)
       SELECT
         test_id,
         started_at::date                                                AS date,
         COUNT(*) FILTER (WHERE status = 'success')                     AS success_count,
         COUNT(*) FILTER (WHERE status IN ('fail', 'timeout'))          AS failure_count,
         ROUND(AVG(duration_ms)::numeric, 2)                            AS avg_latency_ms
       FROM test_runs
       WHERE started_at >= $1::date
         AND started_at <  $2::date
       GROUP BY test_id, started_at::date
       ON CONFLICT (test_id, date) DO UPDATE SET
         success_count  = EXCLUDED.success_count,
         failure_count  = EXCLUDED.failure_count,
         avg_latency_ms = EXCLUDED.avg_latency_ms`,
      [yesterdayStr, tomorrowStr],
    )
    logger.info({ event: 'aggregator.upsert_uptime_daily', from: yesterdayStr, to_exclusive: tomorrowStr }, 'aggregator upserted uptime_daily rows')
  } catch (err) {
    logger.error({ event: 'aggregator.upsert_uptime_daily_failed', err }, 'aggregator failed to upsert uptime_daily')
  }

  try {
    const cutoff = new Date(rawCutoffIso)
    const { rows: partitions } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename ~ '^test_runs_\\d{4}_\\d{2}$'
       ORDER BY tablename`,
    )

    const dropped: string[] = []
    let deletedRuns = 0

    for (const { tablename } of partitions) {
      const m = /^test_runs_(\d{4})_(\d{2})$/.exec(tablename)
      if (!m) continue
      const year = parseInt(m[1]!, 10)
      const month = parseInt(m[2]!, 10) - 1
      const partitionStart = new Date(Date.UTC(year, month, 1))
      const partitionEnd = new Date(Date.UTC(year, month + 1, 1))

      if (partitionEnd <= cutoff) {
        await pool.query(`DROP TABLE IF EXISTS ${tablename}`)
        dropped.push(tablename)
      } else if (partitionStart < cutoff) {
        while (true) {
          const result = await pool.query(
            `DELETE FROM ${tablename}
             WHERE (id, started_at) IN (
               SELECT id, started_at FROM ${tablename}
               WHERE started_at < $1
               ORDER BY started_at ASC
               LIMIT $2
             )`,
            [rawCutoffIso, PRUNE_BATCH_SIZE],
          )
          const batch = result.rowCount ?? 0
          deletedRuns += batch
          if (batch < PRUNE_BATCH_SIZE) break
        }
      }
    }

    logger.info(
      {
        event: 'aggregator.prune_test_runs',
        cutoff: rawCutoffIso,
        dropped_partitions: dropped,
        deleted_rows: deletedRuns,
        batch_size: PRUNE_BATCH_SIZE,
      },
      'aggregator pruned raw test_runs data',
    )
  } catch (err) {
    logger.error({ event: 'aggregator.prune_test_runs_failed', err }, 'aggregator failed to prune test_runs data')
  }

  try {
    const firstOfCurrentMonthUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const ensured: string[] = []
    for (let i = 0; i <= FUTURE_PARTITIONS_TO_CREATE; i++) {
      const start = new Date(Date.UTC(firstOfCurrentMonthUtc.getUTCFullYear(), firstOfCurrentMonthUtc.getUTCMonth() + i, 1))
      const end = new Date(Date.UTC(firstOfCurrentMonthUtc.getUTCFullYear(), firstOfCurrentMonthUtc.getUTCMonth() + i + 1, 1))
      const year = start.getUTCFullYear()
      const month = String(start.getUTCMonth() + 1).padStart(2, '0')
      const tableName = `test_runs_${year}_${month}`
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ${tableName} PARTITION OF test_runs FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`,
      )
      ensured.push(tableName)
    }
    logger.info({ event: 'aggregator.ensure_partitions', partitions: ensured }, 'aggregator ensured monthly partitions')
  } catch (err) {
    logger.error({ event: 'aggregator.ensure_partitions_failed', err }, 'aggregator failed to ensure future partitions')
  }

  try {
    const result = await pool.query(`DELETE FROM uptime_daily WHERE date < (CURRENT_DATE - $1::int)`, [AGG_RETENTION_DAYS])
    logger.info(
      {
        event: 'aggregator.prune_uptime_daily',
        retention_days: AGG_RETENTION_DAYS,
        deleted_rows: result.rowCount ?? 0,
      },
      'aggregator pruned uptime_daily rows',
    )
  } catch (err) {
    logger.error({ event: 'aggregator.prune_uptime_daily_failed', err }, 'aggregator failed to prune uptime_daily')
  }

  logger.info({ event: 'aggregator.run_complete', duration_ms: Date.now() - runStartedAt }, 'aggregator maintenance run complete')
}
