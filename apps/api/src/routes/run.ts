import type { FastifyInstance } from 'fastify'
import type { Test } from '@sentinel/shared'
import { pool } from '../db/pool.js'
import { runTest } from '../executor/run.js'
import { enqueue } from '../db/result-buffer.js'

export async function runRoutes(app: FastifyInstance): Promise<void> {
  // POST /tests/:id/run
  app.post<{ Params: { id: string } }>('/:id/run', async (req, reply) => {
    const { rows } = await pool.query<Test>(
      'SELECT * FROM tests WHERE id = $1',
      [req.params.id]
    )
    const test = rows[0]
    if (test == null) return reply.status(404).send({ error: 'not found' })
    if (!test.enabled) return reply.status(422).send({ error: 'test is disabled' })

    const result = await runTest(test, { trigger: 'api-post' })
    enqueue(result)
    return reply.send(result)
  })

  // GET /tests/:id/run/stream — SSE: triggers execution and streams ctx.log() in real-time
  app.get<{ Params: { id: string } }>('/:id/run/stream', async (req, reply) => {
    const { rows } = await pool.query<Test>(
      'SELECT * FROM tests WHERE id = $1',
      [req.params.id]
    )
    const test = rows[0]

    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    function send(event: string, data: unknown): void {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    if (test == null) {
      send('error', { error: 'not found' })
      res.end()
      return
    }
    if (!test.enabled) {
      send('error', { error: 'test is disabled' })
      res.end()
      return
    }

    try {
      const result = await runTest(test, {
        trigger: 'api-sse',
        onLog: (message) => send('log', { message }),
      })
      enqueue(result)
      send('done', result)
    } catch (err) {
      send('error', { error: err instanceof Error ? err.message : 'Run failed' })
    } finally {
      res.end()
    }
  })
}
