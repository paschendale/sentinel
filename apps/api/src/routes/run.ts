import type { FastifyInstance } from 'fastify'
import { RUN_NOW_ERRORS, runNow } from '../executor/run-now.js'
import { sendError } from './errors.js'

export async function runRoutes(app: FastifyInstance): Promise<void> {
  // POST /tests/:id/run
  app.post<{ Params: { id: string } }>('/:id/run', async (req, reply) => {
    const outcome = await runNow(req.params.id, { trigger: 'api-post' })
    if (outcome.kind !== 'ok') {
      const { status, error } = RUN_NOW_ERRORS[outcome.kind]
      return sendError(reply, status, error)
    }
    return reply.send(outcome.result)
  })

  // GET /tests/:id/run/stream — SSE: triggers execution and streams ctx.log() in real-time
  app.get<{ Params: { id: string } }>('/:id/run/stream', async (req, reply) => {
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

    try {
      const outcome = await runNow(req.params.id, {
        trigger: 'api-sse',
        onLog: (message) => send('log', { message }),
      })
      if (outcome.kind === 'ok') send('done', outcome.result)
      else send('error', { error: RUN_NOW_ERRORS[outcome.kind].error })
    } catch (err) {
      send('error', { error: err instanceof Error ? err.message : 'Run failed' })
    } finally {
      res.end()
    }
  })
}
