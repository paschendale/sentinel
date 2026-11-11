import { buildServer } from './server.js'
import { startScheduler, stopScheduler } from './scheduler/index.js'
import { drain, startFlusher, stopFlusher } from './db/result-buffer.js'
import { ensurePartitions, startAggregator, stopAggregator } from './db/aggregator.js'
import { startFtpTempSweep, stopFtpTempSweep } from './executor/ftp-temp-sweep.js'
import { warmSecretsCache } from './executor/secrets-cache.js'
import { migrate } from './db/migrate.js'
import { startReconciler, stopReconciler } from './notifier/reconciler.js'
import { logger } from './logger.js'
import { fork } from './fork/extension.js'

await migrate()
await ensurePartitions()
await warmSecretsCache()
const app = await buildServer()
await startScheduler()
startFlusher()
startAggregator()
startFtpTempSweep()
startReconciler()
const port = Number(process.env['PORT'] ?? 3001)
await app.listen({ port, host: '0.0.0.0' })
// A fork's background work (apps/api/src/fork/extension.ts). It must not stop the API.
try {
  fork.start?.()
} catch (err) {
  logger.error({ event: 'fork.start_failed', err }, 'fork extension failed to start')
}

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  stopScheduler()
  stopFlusher()
  stopAggregator()
  stopFtpTempSweep()
  stopReconciler()
  await Promise.resolve(fork.stop?.()).catch((err: unknown) => {
    logger.error({ event: 'fork.stop_failed', err }, 'fork extension failed to stop')
  })
  // Waits for a flush already in flight, then writes what is left.
  await drain()
  await app.close()
  process.exit(0)
}

process.on('SIGTERM', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })
