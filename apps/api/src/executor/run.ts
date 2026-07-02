import { nanoid } from 'nanoid'
import type { TestStatus } from '@sentinel/shared'
import { logger } from '../logger.js'
import { getCompiledFn } from './compile.js'
import { buildCtx } from './ctx.js'
import { getSecretsSnapshot } from './secrets-cache.js'

export type RunTrigger = 'scheduler' | 'api-post' | 'api-sse'

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
  const { ctx, getAssertions, getWarnings } = buildCtx({
    testTimeoutMs: test.timeout_ms,
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
  })

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timed out after ${test.timeout_ms}ms`)), test.timeout_ms)
  )

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
