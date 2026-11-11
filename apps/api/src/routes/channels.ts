import type { FastifyInstance } from 'fastify'
import {
  CreateNotificationChannelSchema,
  UpdateNotificationChannelSchema,
  channelRequirementsError,
} from '@sentinel/shared'
import {
  createChannel,
  deleteChannel,
  getChannel,
  getDeliverableChannel,
  listChannels,
  updateChannel,
} from '../db/queries/channels.js'
import { sendChannelTest } from '../notifier/channel-test.js'
import { TransportError } from '../notifier/transports/types.js'
import { sendValidationError } from './errors.js'

export async function channelsRoutes(app: FastifyInstance): Promise<void> {
  // GET /channels — never includes a bot token, only has_bot_token.
  app.get('/', async (_req, reply) => {
    return reply.send(await listChannels())
  })

  // POST /channels
  app.post<{ Body: unknown }>('/', async (req, reply) => {
    const parsed = CreateNotificationChannelSchema.safeParse(req.body)
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error)
    }
    const channel = await createChannel(parsed.data)
    return reply.status(201).send(channel)
  })

  // PATCH /channels/:id — validated against the merged row, so a type change to a bot
  // type without a token (or a webhook type without a URL) is refused.
  app.patch<{ Params: { id: string }; Body: unknown }>('/:id', async (req, reply) => {
    const parsed = UpdateNotificationChannelSchema.safeParse(req.body)
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error)
    }
    const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as typeof parsed.data
    if (Object.keys(patch).length === 0) {
      return reply.status(400).send({ error: 'no fields to update' })
    }
    const existing = await getChannel(req.params.id)
    if (existing === null) {
      return reply.status(404).send({ error: 'channel not found' })
    }
    const merged = {
      type: patch.type ?? existing.type,
      webhook_url: patch.webhook_url ?? existing.webhook_url,
      email_to: patch.email_to ?? existing.email_to,
      channel_ref: patch.channel_ref ?? existing.channel_ref,
      has_bot_token: patch.bot_token !== undefined || existing.has_bot_token,
    }
    const requirement = channelRequirementsError(merged)
    if (requirement !== null) {
      return reply.status(400).send({ error: requirement })
    }
    const channel = await updateChannel(req.params.id, patch)
    if (channel === null) {
      return reply.status(404).send({ error: 'channel not found' })
    }
    return reply.send(channel)
  })

  // DELETE /channels/:id
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const deleted = await deleteChannel(req.params.id)
    if (!deleted) {
      return reply.status(404).send({ error: 'channel not found' })
    }
    return reply.status(204).send()
  })

  // POST /channels/:id/test — delivers a one-off test message, outside any incident.
  app.post<{ Params: { id: string } }>('/:id/test', async (req, reply) => {
    const channel = await getDeliverableChannel(req.params.id)
    if (channel === null) {
      return reply.status(404).send({ error: 'channel not found' })
    }
    try {
      const result = await sendChannelTest(channel)
      return reply.send({ ok: true, ...result })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(502).send({
        ok: false,
        error: message,
        http_status: err instanceof TransportError ? err.httpStatus : null,
      })
    }
  })
}
