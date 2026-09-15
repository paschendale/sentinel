import type { FastifyInstance } from 'fastify'
import { listStations } from '../db/queries/rbmc.js'
import { syncRbmcStations } from '../rbmc/sync.js'

/** Admin routes (JWT-protected by the global hook — not in PUBLIC_ROUTES). */
export async function rbmcRoutes(app: FastifyInstance): Promise<void> {
  // GET /rbmc — every station with its linked test and live state.
  app.get('/', async (_req, reply) => {
    return reply.send(await listStations())
  })

  // POST /rbmc/sync — re-read the shapefile now (same as the mtime poller / startup).
  app.post('/sync', async (_req, reply) => {
    const summary = await syncRbmcStations({ reason: 'manual' })
    return reply.status(summary.ok ? 200 : 503).send(summary)
  })
}
