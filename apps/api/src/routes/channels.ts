import type { FastifyInstance } from 'fastify'
import { nanoid } from 'nanoid'
import { CreateNotificationChannelSchema, UpdateNotificationChannelSchema } from '@sentinel/shared'
import type { NotificationChannel } from '@sentinel/shared'
import { pool } from '../db/pool.js'

export async function channelsRoutes(app: FastifyInstance): Promise<void> {
  // GET /channels
  app.get('/', async (_req, reply) => {
    const { rows } = await pool.query<NotificationChannel>(
      'SELECT * FROM notification_channels ORDER BY name ASC',
    )
    return reply.send(rows)
  })

  // POST /channels
  app.post<{ Body: unknown }>('/', async (req, reply) => {
    const parsed = CreateNotificationChannelSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }
    const d = parsed.data
    const id = nanoid()
    const { rows } = await pool.query<NotificationChannel>(
      `INSERT INTO notification_channels (id, name, type, webhook_url, email_to, enabled)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, d.name, d.type, d.webhook_url ?? null, d.email_to ?? null, d.enabled],
    )
    return reply.status(201).send(rows[0])
  })

  // PATCH /channels/:id
  app.patch<{ Params: { id: string }; Body: unknown }>('/:id', async (req, reply) => {
    const parsed = UpdateNotificationChannelSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }
    const d = parsed.data
    const fields = Object.entries(d).filter(([, v]) => v !== undefined)
    if (fields.length === 0) {
      return reply.status(400).send({ error: 'no fields to update' })
    }
    const setClauses = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ')
    const values = fields.map(([, v]) => v)
    const { rows } = await pool.query<NotificationChannel>(
      `UPDATE notification_channels SET ${setClauses} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values],
    )
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'channel not found' })
    }
    return reply.send(rows[0])
  })

  // DELETE /channels/:id
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { rowCount } = await pool.query(
      'DELETE FROM notification_channels WHERE id = $1',
      [req.params.id],
    )
    if (!rowCount) {
      return reply.status(404).send({ error: 'channel not found' })
    }
    return reply.status(204).send()
  })
}
