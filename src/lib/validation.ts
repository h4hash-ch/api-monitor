import { z } from 'zod';
import { ALLOWED_INTERVALS } from '../db/models';

const MAX_URL_LENGTH = 2_048;

const httpUrl = z
  .string()
  .max(MAX_URL_LENGTH, 'URL must not exceed 2048 characters')
  .url()
  .refine(
    (value) =>
      ['http:', 'https:'].includes(new URL(value).protocol),
    'URL must use HTTP or HTTPS',
  );

const webhookUrl = z
  .string()
  .max(MAX_URL_LENGTH, 'URL must not exceed 2048 characters')
  .url()
  .refine(
    (value) => new URL(value).protocol === 'https:',
    'Webhook URL must use HTTPS',
  );

export const monitorInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    url: httpUrl,

    enabled: z.boolean().optional(),

    interval_minutes: z.union(
      ALLOWED_INTERVALS.map((x) => z.literal(x)) as [
        z.ZodLiteral<1>,
        z.ZodLiteral<5>,
        z.ZodLiteral<10>,
        z.ZodLiteral<15>,
        z.ZodLiteral<30>
      ]
    ),

    notification_email_enabled: z.boolean().optional(),
    notification_webhook_enabled: z.boolean().optional(),

    webhook_url: webhookUrl.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.notification_webhook_enabled &&
      !value.webhook_url
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Webhook URL is required when webhook notifications are enabled',
        path: ['webhook_url'],
      });
    }
  });

// PATCH validation intentionally does not enforce the cross-field webhook
// rule on the partial payload alone. MonitorRepository.update() validates the
// fully merged persisted configuration, so enabling webhooks can reuse an
// already configured URL while invalid final states are still rejected.
export const monitorPatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  url: httpUrl.optional(),
  enabled: z.boolean().optional(),
  interval_minutes: z.union(
    ALLOWED_INTERVALS.map((x) => z.literal(x)) as [
      z.ZodLiteral<1>,
      z.ZodLiteral<5>,
      z.ZodLiteral<10>,
      z.ZodLiteral<15>,
      z.ZodLiteral<30>,
    ],
  ).optional(),
  notification_email_enabled: z.boolean().optional(),
  notification_webhook_enabled: z.boolean().optional(),
  webhook_url: webhookUrl.nullable().optional(),
}).strict();

export const reportQuery = z
  .object({
    from: z.string().date(),
    to: z.string().date(),
  })
  .refine(
    (value) => value.from <= value.to,
    'from must not be later than to'
  )
  .refine(
    (value) =>
      Date.parse(value.to) - Date.parse(value.from) <=
      90 * 86_400_000,
    'Reporting period cannot exceed 90 days'
  );
