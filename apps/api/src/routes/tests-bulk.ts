import type { FastifyInstance } from 'fastify'
import { BulkTestSchema, type BulkTestResult, type Test } from '@sentinel/shared'
import { pool } from '../db/pool.js'
import {
  addTagToTests,
  deleteTests,
  getTestsByIds,
  removeTagFromTests,
  setTestsEnabled,
} from '../db/queries/tests.js'
import { testEvents } from '../events.js'
import { invalidateCache } from '../executor/compile.js'
import { runNow } from '../executor/run-now.js'
import { logger } from '../logger.js'
import { isRunning } from '../scheduler/run-guard.js'
import { normalizeTag } from '../tags/normalize.js'
import { sendError, sendValidationError } from './errors.js'

/** Same limit as TestFieldsSchema.tags. */
const MAX_TAGS = 20

/**
 * POST /tests/bulk — one action on many tests. Writes happen in one transaction; the response
 * lists every requested id with its own outcome, in request order. `run` starts the runs and
 * returns at once: each run is recorded like any other.
 */
export async function testsBulkRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>('/bulk', async (req, reply) => {
    const parsed = BulkTestSchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(reply, parsed.error)
    const { action } = parsed.data
    const ids = [...new Set(parsed.data.ids)]
    const tag = parsed.data.tag === undefined ? undefined : normalizeTag(parsed.data.tag)
    if ((action === 'add_tag' || action === 'remove_tag') && !tag) return sendError(reply, 400, 'tag must not be empty')

    if (action === 'run') {
      const tests = new Map((await getTestsByIds(ids)).map((t) => [t.id, t]))
      const results: BulkTestResult[] = ids.map((id) => {
        const test = tests.get(id)
        if (test === undefined) return { id, ok: false, error: 'not found' }
        if (!test.enabled) return { id, ok: false, error: 'test is disabled' }
        if (isRunning(id)) return { id, ok: false, error: 'a run of this test is already in progress' }
        runNow(id, { trigger: 'api-post' }).catch((err: unknown) => {
          logger.error({ event: 'tests.bulk_run_failed', test_id: id, err }, `bulk run of test ${id} failed`)
        })
        return { id, ok: true, started: true }
      })
      return reply.send({ action, results })
    }

    const client = await pool.connect()
    let changed: Test[] = []
    let deleted: string[] = []
    const refused = new Map<string, string>()
    let existing: Set<string>
    try {
      await client.query('BEGIN')
      const rows = await getTestsByIds(ids, client)
      existing = new Set(rows.map((t) => t.id))
      if (action === 'add_tag') {
        for (const t of rows) {
          if (!t.tags.includes(tag!) && t.tags.length >= MAX_TAGS) refused.set(t.id, `a test has at most ${MAX_TAGS} tags`)
        }
      }
      const present = ids.filter((id) => existing.has(id) && !refused.has(id))
      if (present.length > 0) {
        if (action === 'enable' || action === 'disable') changed = await setTestsEnabled(client, present, action === 'enable')
        else if (action === 'add_tag') changed = await addTagToTests(client, present, tag!)
        else if (action === 'remove_tag') changed = await removeTagFromTests(client, present, tag!)
        else deleted = await deleteTests(client, present)
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }

    for (const test of changed) testEvents.emit('test:updated', test)
    for (const id of deleted) {
      invalidateCache(id)
      testEvents.emit('test:deleted', id)
    }

    const results: BulkTestResult[] = ids.map((id) => {
      if (!existing.has(id)) return { id, ok: false, error: 'not found' }
      const reason = refused.get(id)
      return reason === undefined ? { id, ok: true } : { id, ok: false, error: reason }
    })
    return reply.send({ action, results })
  })
}
