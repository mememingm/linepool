import { z } from 'zod';

// LINEPOOL's internal contract, deliberately independent of any supplier's wire format.
const timestamp = z.string().datetime({ offset: true });
const uuid = z.string().uuid();
export const dataSourceSchema = z.enum(['mock', 'live']);
export const renewalDurationSchema = z.number().int().min(1).max(365);
export const renewalOptionSchema = z.object({
  durationDays: renewalDurationSchema,
  totalPoints: z.number().int().positive().nullable(),
  estimatedExpiresAt: timestamp,
});
export const renewalOptionsSchema = z.object({
  numberId: uuid, currentExpiresAt: timestamp, source: dataSourceSchema,
  options: z.array(renewalOptionSchema),
});
export const createRenewalInputSchema = z.strictObject({
  durationDays: renewalDurationSchema, originalExpiresAt: timestamp, idempotencyKey: uuid,
});
export const renewalRecordSchema = z.object({
  id: uuid, renewalNumber: z.string(), numberId: uuid, phoneNumber: z.string(),
  durationDays: renewalDurationSchema, originalExpiresAt: timestamp,
  estimatedExpiresAt: timestamp.nullable(), confirmedExpiresAt: timestamp.nullable(),
  totalPoints: z.number().int().positive().nullable(),
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED']), source: dataSourceSchema,
  failureReason: z.string().nullable(), createdAt: timestamp,
}).refine(record => record.status !== 'SUCCESS' || (record.source === 'live' && record.confirmedExpiresAt !== null), {
  message: 'A successful renewal requires a live confirmation and confirmed expiry',
});
export const usageScenarioSchema = z.enum(['standard', 'unlimited', 'no_package', 'unsupported', 'error']);
export const usageQuerySchema = z.strictObject({ scenario: usageScenarioSchema.optional() });
const amount = z.number().finite().nonnegative();
const meteredUsageSchema = z.object({
  kind: z.literal('metered'), total: amount, used: amount, remaining: amount,
}).refine(item => Math.abs(item.remaining - Math.max(0, item.total - item.used)) < 0.000001, {
  message: 'Remaining usage must agree with the total and used amounts',
});
export const usageQuotaSchema = z.discriminatedUnion('kind', [
  meteredUsageSchema,
  z.object({ kind: z.literal('unlimited'), used: amount.nullable() }),
  z.object({ kind: z.enum(['no_package', 'unsupported', 'error']) }),
]);
export const numberUsageSchema = z.object({
  numberId: uuid, source: dataSourceSchema, updatedAt: timestamp.nullable(),
  sms: usageQuotaSchema, voice: usageQuotaSchema, data: usageQuotaSchema,
});
export type RenewalOptions = z.infer<typeof renewalOptionsSchema>;
export type CreateRenewalInput = z.infer<typeof createRenewalInputSchema>;
export type RenewalRecord = z.infer<typeof renewalRecordSchema>;
export type NumberUsage = z.infer<typeof numberUsageSchema>;
export type UsageQuota = z.infer<typeof usageQuotaSchema>;
export type UsageScenario = z.infer<typeof usageScenarioSchema>;
export type UsageQuery = z.infer<typeof usageQuerySchema>;
