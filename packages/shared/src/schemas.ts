import { z } from 'zod'

// Exported for consumers that need per-field shapes (e.g. MCP tool input schemas) —
// CreateTestSchema is a ZodEffects (refine) and has no .shape.
export const TestFieldsSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1),
  schedule_ms: z.number().int().min(30_000),
  timeout_ms: z.number().int().min(1_000).default(5_000),
  retries: z.number().int().min(0).max(5).default(0),
  uses_browser: z.boolean().default(false),
  enabled: z.boolean().default(true),
  failure_threshold: z.number().int().min(1).default(3),
  cooldown_ms: z.number().int().min(0).default(86_400_000),
  tags: z.array(z.string().min(1).max(50)).max(20).default([]),
})

// timeout_ms must leave room below schedule_ms (jitter + scheduling overhead) so the
// scheduler never has two overlapping runs of the same test in flight — see the
// per-test overlap guard in apps/api/src/scheduler/index.ts.
export const TIMEOUT_TO_SCHEDULE_MAX_RATIO = 0.8

export const CreateTestSchema = TestFieldsSchema.refine(
  (d) => d.timeout_ms <= d.schedule_ms * TIMEOUT_TO_SCHEDULE_MAX_RATIO,
  {
    message: `timeout_ms must be at most ${TIMEOUT_TO_SCHEDULE_MAX_RATIO * 100}% of schedule_ms`,
    path: ['timeout_ms'],
  }
)

// No cross-field refine here: a PATCH body may only touch one of the two fields, so
// validating the margin against the final merged row is left to the DB CHECK constraint
// (tests_timeout_schedule_margin_check), which always sees the post-update row.
export const UpdateTestSchema = TestFieldsSchema.partial()

export const NotificationChannelTypeSchema = z.enum(['discord', 'slack', 'webhook', 'email', 'discord_bot', 'slack_bot'])

// Per-field shapes, exported for the MCP tool input schemas (the refined create schema has no .shape).
export const NotificationChannelFieldsShape = {
  name: z.string().min(1).max(100),
  type: NotificationChannelTypeSchema,
  webhook_url: z.string().url().optional(),
  email_to: z.array(z.string().email()).min(1).max(10).optional(),
  /** Bot token for discord_bot / slack_bot. Write-only: never returned. */
  bot_token: z.string().min(1).max(500).optional(),
  /** Slack channel ID (C…) or Discord channel ID for discord_bot / slack_bot. */
  channel_ref: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
}

/**
 * What each channel type needs. Returns a message when something is missing, else null.
 * Used by the create schema (refine) and by the PATCH route against the merged row.
 */
export function channelRequirementsError(input: {
  type: z.infer<typeof NotificationChannelTypeSchema>
  webhook_url?: string | null | undefined
  email_to?: string[] | null | undefined
  channel_ref?: string | null | undefined
  has_bot_token: boolean
}): string | null {
  switch (input.type) {
    case 'email':
      return (input.email_to?.length ?? 0) > 0 ? null : 'email_to required for email channels'
    case 'discord_bot':
    case 'slack_bot':
      if (!input.has_bot_token) return 'bot_token required for discord_bot and slack_bot channels'
      if (!input.channel_ref) return 'channel_ref (the channel ID the bot posts into) required for discord_bot and slack_bot channels'
      return null
    default:
      return input.webhook_url ? null : 'webhook_url required for discord, slack and webhook channels'
  }
}

export const CreateNotificationChannelSchema = z.object({
  ...NotificationChannelFieldsShape,
  enabled: z.boolean().default(true),
}).superRefine((d, ctx) => {
  const err = channelRequirementsError({ ...d, has_bot_token: d.bot_token !== undefined })
  if (err !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err })
})

// No cross-field refine here: a PATCH may touch one field at a time, so the route
// validates channelRequirementsError() against the merged row.
export const UpdateNotificationChannelSchema = z.object(NotificationChannelFieldsShape).partial()

export const NotificationEventTypeSchema = z.enum(['fail', 'warning', 'recovery'])

export const CreateAssignmentSchema = z.object({
  channel_id: z.string().min(1),
  event_types: z.array(NotificationEventTypeSchema).min(1).max(3).default(['fail', 'warning', 'recovery']),
})

// UPPER_SNAKE_CASE — this is the literal property key under ctx.secrets, so it must
// be a valid JS identifier and match the ctx.secrets.SECRET_NAME convention.
export const CreateSecretSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[A-Z][A-Z0-9_]*$/, 'name must be UPPER_SNAKE_CASE (e.g. API_KEY)'),
  value: z.string().min(1),
})

export const RotateSecretSchema = z.object({
  value: z.string().min(1),
})

export const BULK_TEST_ACTIONS = ['enable', 'disable', 'run', 'delete', 'add_tag', 'remove_tag'] as const
export type BulkTestAction = (typeof BULK_TEST_ACTIONS)[number]
/** Most tests one bulk request may touch. */
export const BULK_MAX_IDS = 200

export const BulkTestFieldsShape = {
  ids: z.array(z.string().min(1).max(255)).min(1).max(BULK_MAX_IDS),
  action: z.enum(BULK_TEST_ACTIONS),
  /** Required for add_tag and remove_tag. */
  tag: z.string().min(1).max(50).optional(),
}

export const BulkTestSchema = z.object(BulkTestFieldsShape).superRefine((d, ctx) => {
  if ((d.action === 'add_tag' || d.action === 'remove_tag') && (d.tag === undefined || d.tag.trim() === '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tag'], message: `tag is required for ${d.action}` })
  }
})

export type BulkTestInput = z.infer<typeof BulkTestSchema>

export type CreateTestInput = z.infer<typeof CreateTestSchema>
export type UpdateTestInput = z.infer<typeof UpdateTestSchema>
export type CreateNotificationChannelInput = z.infer<typeof CreateNotificationChannelSchema>
export type UpdateNotificationChannelInput = z.infer<typeof UpdateNotificationChannelSchema>
export type CreateAssignmentInput = z.infer<typeof CreateAssignmentSchema>
export type CreateSecretInput = z.infer<typeof CreateSecretSchema>
export type RotateSecretInput = z.infer<typeof RotateSecretSchema>
