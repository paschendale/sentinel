import { buildServer } from './server.js'
import { startScheduler, stopScheduler } from './scheduler/index.js'
import { startFlusher, stopFlusher, flush } from './db/result-buffer.js'
import { ensurePartitions, startAggregator, stopAggregator } from './db/aggregator.js'
import { migrate } from './db/migrate.js'

await migrate()
await ensurePartitions()
const app = await buildServer()
await startScheduler()
startFlusher()
startAggregator()
const port = Number(process.env['PORT'] ?? 3001)
await app.listen({ port, host: '0.0.0.0' })

async function shutdown(): Promise<void> {
  stopScheduler()
  stopFlusher()
  stopAggregator()
  await flush()
  await app.close()
  process.exit(0)
}

process.on('SIGTERM', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })
