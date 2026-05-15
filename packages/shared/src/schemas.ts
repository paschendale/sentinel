import { z } from 'zod'

export const CreateTestSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1),
  schedule_ms: z.number().int().min(30_000),
  timeout_ms: z.number().int().min(1_000).max(10_000).default(5_000),
  retries: z.number().int().min(0).max(5).default(0),
  uses_browser: z.boolean().default(false),
  enabled: z.boolean().default(true),
  failure_threshold: z.number().int().min(1).default(3),
  cooldown_ms: z.number().int().min(0).default(86_400_000),
  tags: z.array(z.string().min(1).max(50)).max(20).default([]),
})

export const UpdateTestSchema = CreateTestSchema.partial()

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
