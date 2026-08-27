import type { FastifyInstance } from 'fastify'
import { pool } from '../db/pool.js'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_req, reply) => {
    try {
      await pool.query('SELECT 1')
      return reply.send({ status: 'ok' })
    } catch (err) {
      return reply.status(503).send({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  })
}
