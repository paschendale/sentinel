import type { FastifyInstance } from 'fastify'
import { nanoid } from 'nanoid'
import { CreateSecretSchema, RotateSecretSchema } from '@sentinel/shared'
import {
  createSecret,
  rotateSecretValue,
  deleteSecret,
  listSecretsMetadata,
} from '../db/queries/secrets.js'
import { warmSecretsCache } from '../executor/secrets-cache.js'
import { isEncryptionConfigured } from '../crypto/secret-cipher.js'

function isUniqueViolation(err: unknown): err is { code: string; constraint?: string } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505'
}

export async function secretsRoutes(app: FastifyInstance): Promise<void> {
  // GET /secrets
  app.get('/', async (_req, reply) => {
    const secrets = await listSecretsMetadata()
    return reply.send(secrets)
  })

  // GET /secrets/status
  app.get('/status', async (_req, reply) => {
    return reply.send({ encryptionEnabled: isEncryptionConfigured() })
  })

  // POST /secrets
  app.post<{ Body: unknown }>('/', async (req, reply) => {
    const parsed = CreateSecretSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }
    const d = parsed.data
    const id = nanoid()
    try {
      const secret = await createSecret(id, d.name, d.value)
      await warmSecretsCache()
      return reply.status(201).send(secret)
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: 'secret with this name already exists' })
      }
      throw err
    }
  })

  // POST /secrets/:id/rotate
  app.post<{ Params: { id: string }; Body: unknown }>('/:id/rotate', async (req, reply) => {
    const parsed = RotateSecretSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }
    const secret = await rotateSecretValue(req.params.id, parsed.data.value)
    if (!secret) {
      return reply.status(404).send({ error: 'secret not found' })
    }
    await warmSecretsCache()
    return reply.send(secret)
  })

  // DELETE /secrets/:id
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const deleted = await deleteSecret(req.params.id)
    if (!deleted) {
      return reply.status(404).send({ error: 'secret not found' })
    }
    await warmSecretsCache()
    return reply.status(204).send()
  })
}
