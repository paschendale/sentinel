import Fastify from 'fastify'
import { logger } from './logger.js'
import { testsRoutes } from './routes/tests.js'
import { runRoutes } from './routes/run.js'
import { metricsRoutes } from './routes/metrics.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { statusRoutes } from './routes/status.js'
import { authRoutes } from './routes/auth.js'
import { channelsRoutes } from './routes/channels.js'
import { tagsRoutes } from './routes/tags.js'
import { secretsRoutes } from './routes/secrets.js'
import { verifyJwt } from './auth/jwt.js'

const PUBLIC_ROUTES: Array<{ method: string; prefix: string }> = [
  { method: 'POST', prefix: '/auth/login' },
  { method: 'GET', prefix: '/status' },
  { method: 'GET', prefix: '/metrics' },
]

function isPublic(method: string, url: string): boolean {
  return PUBLIC_ROUTES.some(
    (r) => r.method === method && url === r.prefix ||
           r.method === method && url.startsWith(r.prefix + '/') ||
           r.method === method && url.startsWith(r.prefix + '?')
  )
}

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: true,
  })

  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode < 400) return
    const url = request.url.split('?')[0] ?? request.url
    logger.warn(
      {
        event: 'http.inbound.error',
        method: request.method,
        url,
        statusCode: reply.statusCode,
        responseTimeMs: reply.elapsedTime,
      },
      `inbound HTTP ${request.method} ${url} -> ${reply.statusCode} (${reply.elapsedTime.toFixed(1)}ms)`
    )
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (request.method === 'OPTIONS') {
      return reply.status(204).send()
    }
  })

  app.addHook('onRequest', async (request, reply) => {
    if (isPublic(request.method, request.url.split('?')[0]!)) return

    const authHeader = request.headers['authorization']
    const queryToken = (request.query as Record<string, string | undefined>)['token']
    const raw = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken

    if (!raw || !verifyJwt(raw)) {
      return reply.status(401).send({ error: 'unauthorized' })
    }
  })

  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(testsRoutes, { prefix: '/tests' })
  await app.register(runRoutes, { prefix: '/tests' })
  await app.register(metricsRoutes)
  await app.register(dashboardRoutes, { prefix: '/dashboard' })
  await app.register(statusRoutes, { prefix: '/status' })
  await app.register(channelsRoutes, { prefix: '/channels' })
  await app.register(tagsRoutes, { prefix: '/tags' })
  await app.register(secretsRoutes, { prefix: '/secrets' })
  return app
}
