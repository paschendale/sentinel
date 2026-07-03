import type { FastifyInstance, FastifyReply } from 'fastify'
import { CreateAssignmentSchema } from '@sentinel/shared'
import { pool } from '../db/pool.js'
import { getAssignedChannels, addAssignment, removeAssignment, getDistinctTags } from '../db/queries/assignments.js'
import { normalizeTag } from '../tags/normalize.js'

function parseTagOrReply(tag: string, reply: FastifyReply): string | null {
  const normalized = normalizeTag(tag)
  if (normalized.length === 0) {
    reply.status(400).send({ error: 'invalid tag' })
    return null
  }
  return normalized
}

export async function tagsRoutes(app: FastifyInstance): Promise<void> {
  // GET /tags
  app.get('/', async (_req, reply) => {
    const tags = await getDistinctTags()
    return reply.send(tags)
  })

  // GET /tags/:tag/channels
  app.get<{ Params: { tag: string } }>('/:tag/channels', async (req, reply) => {
    const tag = parseTagOrReply(req.params.tag, reply)
    if (tag === null) return
    const channels = await getAssignedChannels('tag', tag)
    return reply.send(channels)
  })

  // POST /tags/:tag/channels
  app.post<{ Params: { tag: string }; Body: unknown }>('/:tag/channels', async (req, reply) => {
    const tag = parseTagOrReply(req.params.tag, reply)
    if (tag === null) return
    const parsed = CreateAssignmentSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { rows: chExists } = await pool.query<{ id: string }>(
      'SELECT id FROM notification_channels WHERE id = $1',
      [parsed.data.channel_id]
    )
    if (chExists.length === 0) return reply.status(404).send({ error: 'channel not found' })
    await addAssignment(parsed.data.channel_id, 'tag', tag, parsed.data.event_types)
    return reply.status(201).send()
  })

  // DELETE /tags/:tag/channels/:channel_id
  app.delete<{ Params: { tag: string; channel_id: string } }>('/:tag/channels/:channel_id', async (req, reply) => {
    const tag = parseTagOrReply(req.params.tag, reply)
    if (tag === null) return
    await removeAssignment(req.params.channel_id, 'tag', tag)
    return reply.status(204).send()
  })
}
