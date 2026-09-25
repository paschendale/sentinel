import { nanoid } from 'nanoid'
import { TIMEOUT_TO_SCHEDULE_MAX_RATIO } from '@sentinel/shared'
import type { TestStatus } from '@sentinel/shared'
import { logger } from '../logger.js'
import { getCompiledFn } from './compile.js'
import { buildCtx } from './ctx.js'
import { getSecretsSnapshot } from './secrets-cache.js'

export type RunTrigger = 'scheduler' | 'api-post' | 'api-sse' | 'mcp'

export interface RunTestOptions {
  trigger: RunTrigger
  onLog?: (message: string) => void
}

export interface RunResult {
  id: string
  test_id: string
  started_at: Date
  finished_at: Date
  status: TestStatus
  duration_ms: number
  error_message: string | null
  assertions: Array<{ id: string; name: string; passed: boolean; message: string | null }>
}

interface TestInput {
  id: string
  code: string
  timeout_ms: number
}

export async function runTest(test: TestInput, options: RunTestOptions): Promise<RunResult> {
  const runId = nanoid()
  const startedAt = new Date()
  const startMs = Date.now()

  const runLog = logger.child({
    test_id: test.id,
    run_id: runId,
    trigger: options.trigger,
  })

  runLog.info(
    { event: 'test.run.start' },
    `test run started: trigger=${options.trigger} test_id=${test.id} run_id=${runId}`
  )

  let status: TestStatus = 'success'
  let errorMessage: string | null = null

  const fn = getCompiledFn(test.id, test.code)
  // Aborted when the run times out, so pending ctx I/O is cancelled instead of outliving the run.
  const runAbort = new AbortController()
  const { ctx, getAssertions, getWarnings, getInFlight } = buildCtx({
    testTimeoutMs: test.timeout_ms,
    signal: runAbort.signal,
    secrets: getSecretsSnapshot(),
    onLog: (message) => {
      runLog.info({ event: 'test.user_log' }, `[ctx.log] ${message}`)
      options.onLog?.(message)
    },
    onHttpComplete: (info) => {
      runLog.info(
        { event: 'test.http', ...info },
        `HTTP ${info.method} ${info.url} -> ${info.status} (${info.duration_ms}ms)`
      )
    },
    onFtpComplete: (info) => {
      runLog.info(
        { event: 'test.ftp', ...info },
        `FTP ${info.op} ${info.host}${info.path} (${info.duration_ms}ms${info.size !== undefined ? `, ${info.size} bytes` : ''})`
      )
    },
    onIoError: (info) => {
      runLog.warn(
        { event: 'test.io_error', ...info },
        `${info.protocol.toUpperCase()} ${info.op} ${info.url} failed: ${info.code} (${info.duration_ms}ms)`
      )
    },
    onS3Complete: (info) => {
      runLog.info(
        { event: 'test.s3', ...info },
        `S3 ${info.method} ${info.url} -> ${info.status} (${info.duration_ms}ms, region=${info.region})`
      )
    },
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Describe pending calls before aborting them — the abort settles them.
      const inFlight = getInFlight()
      runAbort.abort(new Error(`test run timed out after ${test.timeout_ms}ms`))
      reject(
        new Error(
          `Timed out after ${test.timeout_ms}ms` + (inFlight.length > 0 ? `; in flight: ${inFlight.join('; ')}` : '')
        )
      )
    }, test.timeout_ms)
  })

  try {
    await Promise.race([
      Promise.resolve(fn(ctx)),
      timeoutPromise,
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('Timed out after')) {
      status = 'timeout'
    } else {
      status = 'fail'
    }
    errorMessage = msg
  } finally {
    clearTimeout(timer)
  }

  if (status === 'success' && getWarnings().length > 0) {
    status = 'warn'
    errorMessage = getWarnings().join('; ')
  }

  const finishedAt = new Date()
  const durationMs = Date.now() - startMs

  // Persist assertion results (batch)
  const assertions = getAssertions()
  const assertionPassed = assertions.filter((a) => a.passed).length
  const assertionFailed = assertions.length - assertionPassed

  const resultSummary =
    status === 'success'
      ? 'passed'
      : status === 'warn'
        ? 'warned'
        : status === 'timeout'
          ? 'timed out'
          : 'failed'

  runLog.info(
    {
      event: 'test.run.complete',
      status,
      duration_ms: durationMs,
      assertion_count: assertions.length,
      assertion_passed: assertionPassed,
      assertion_failed: assertionFailed,
      error_message: errorMessage,
    },
    `test run ${resultSummary}: test_id=${test.id} run_id=${runId} status=${status} duration_ms=${durationMs}` +
      (assertions.length > 0
        ? ` assertions=${assertionPassed}ok/${assertionFailed}fail`
        : '') +
      (errorMessage != null && errorMessage.length > 0 ? ` error=${errorMessage.slice(0, 300)}` : '')
  )

  return {
    id: runId,
    test_id: test.id,
    started_at: startedAt,
    finished_at: finishedAt,
    status,
    duration_ms: durationMs,
    error_message: errorMessage,
    assertions: assertions.map((a) => ({ id: nanoid(), name: a.name, passed: a.passed, message: a.message ?? null })),
  }
}

interface RetryableTestInput extends TestInput {
  retries: number
  schedule_ms: number
}

function isFailure(status: TestStatus): boolean {
  return status === 'fail' || status === 'timeout'
}

/**
 * Runs a test and, while the attempt fails or times out, re-runs it up to `test.retries` more
 * times. One result is recorded: the last attempt's. A retry only starts if a full attempt
 * (timeout_ms) still fits inside TIMEOUT_TO_SCHEDULE_MAX_RATIO of schedule_ms, measured from
 * the first attempt, so retries never make a run overlap the test's next scheduled run.
 */
export async function runTestWithRetries(test: RetryableTestInput, options: RunTestOptions): Promise<RunResult> {
  const startMs = Date.now()
  const maxTotalMs = test.schedule_ms * TIMEOUT_TO_SCHEDULE_MAX_RATIO
  const maxAttempts = 1 + Math.max(0, Math.floor(test.retries))
  const earlierErrors: string[] = []

  let attempt = 1
  let result = await runTest(test, options)
  while (isFailure(result.status) && attempt < maxAttempts) {
    const elapsedMs = Date.now() - startMs
    if (elapsedMs + test.timeout_ms > maxTotalMs) {
      logger.warn(
        { event: 'test.retry.skipped', test_id: test.id, attempt, elapsed_ms: elapsedMs },
        `retry skipped: test_id=${test.id} another ${test.timeout_ms}ms attempt would exceed ${maxTotalMs}ms of the schedule`
      )
      break
    }
    earlierErrors.push(result.error_message ?? result.status)
    attempt += 1
    logger.info(
      { event: 'test.retry', test_id: test.id, attempt, max_attempts: maxAttempts },
      `retrying test_id=${test.id} attempt ${attempt}/${maxAttempts} after: ${(result.error_message ?? result.status).slice(0, 300)}`
    )
    result = await runTest(test, options)
  }

  if (attempt > 1 && isFailure(result.status) && result.error_message != null) {
    return { ...result, error_message: `${result.error_message} [all ${attempt} attempts failed]` }
  }
  if (attempt > 1 && !isFailure(result.status)) {
    logger.info(
      { event: 'test.retry.recovered', test_id: test.id, attempt },
      `test_id=${test.id} passed on attempt ${attempt} after: ${earlierErrors.join(' | ').slice(0, 300)}`
    )
  }
  return result
}
