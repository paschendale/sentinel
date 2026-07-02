import { z } from 'zod'

const TestFieldsSchema = z.object({
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
const TIMEOUT_TO_SCHEDULE_MAX_RATIO = 0.8

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

export const CreateNotificationChannelSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['discord', 'slack', 'webhook', 'email']),
  webhook_url: z.string().url().optional(),
  email_to: z.array(z.string().email()).min(1).max(10).optional(),
  enabled: z.boolean().default(true),
}).refine(
  d => d.type === 'email' ? (d.email_to?.length ?? 0) > 0 : !!d.webhook_url,
  { message: 'webhook_url required for webhook channels; email_to required for email channels' },
)

export const UpdateNotificationChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['discord', 'slack', 'webhook', 'email']).optional(),
  webhook_url: z.string().url().optional(),
  email_to: z.array(z.string().email()).min(1).max(10).optional(),
  enabled: z.boolean().optional(),
})

export const CreateAssignmentSchema = z.object({
  channel_id: z.string().min(1),
})

export type CreateTestInput = z.infer<typeof CreateTestSchema>
export type UpdateTestInput = z.infer<typeof UpdateTestSchema>
export type CreateNotificationChannelInput = z.infer<typeof CreateNotificationChannelSchema>
export type UpdateNotificationChannelInput = z.infer<typeof UpdateNotificationChannelSchema>
export type CreateAssignmentInput = z.infer<typeof CreateAssignmentSchema>
