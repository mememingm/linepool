import { z } from 'zod';
import { uuidSchema, timestampSchema, paginationQuerySchema } from './primitives.js';

export const pcCapabilitySchema = z.enum(['SMS_CODE', 'NUMBER_LEASE', 'SEND_SMS']);
export const pcConnectionSchema = z.object({
  id: uuidSchema, ownerKind: z.enum(['SELF_SERVICE', 'AGENT']), agentId: uuidSchema.nullable(),
  externalAccountId: z.string(), siteId: z.enum(['linepool', 'once']),
  status: z.enum(['ACTIVE', 'UNAUTHORIZED', 'REFRESHING', 'UNKNOWN', 'REAUTH_REQUIRED']),
  capabilities: z.array(pcCapabilitySchema), enabledCapabilities: z.array(pcCapabilitySchema),
  accessExpiresAt: timestampSchema.nullable(), refreshExpiresAt: timestampSchema.nullable(),
  lastSyncedAt: timestampSchema.nullable(), nextPollAt: timestampSchema.nullable(), problem: z.string().nullable(),
});
export const pcNumberSchema = z.object({
  id: uuidSchema, phoneNumber: z.string(), regionId: z.string(),
  resourceExpiresAt: timestampSchema.nullable(), sourceMissing: z.boolean(), capabilities: z.array(pcCapabilitySchema),
});
export const pcPlanInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120), durationDays: z.number().int().min(1).max(3650),
  amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/),
  capability: pcCapabilitySchema, enabled: z.boolean(),
});
export const pcPlanSchema = pcPlanInputSchema.extend({ id: uuidSchema });
export const pcMessageSchema = z.object({
  id: z.string(), numberId: uuidSchema, phoneNumber: z.string(), sender: z.string(), body: z.string(),
  verificationCode: z.string().nullable(), receivedAt: timestampSchema, isRead: z.boolean(),
});
export const pcSessionSchema = z.object({
  connection: pcConnectionSchema.nullable(), numbers: z.array(pcNumberSchema), plans: z.array(pcPlanSchema),
  /** True when this agent's connection backs the site's ACTIVE official shop (its numbers are sold on the storefront). */
  officialShop: z.boolean().optional(),
});
export const pcAuthStartInputSchema = z.strictObject({ purpose: z.enum(['AGENT_LOGIN', 'REAUTHORIZE', 'SELF_SERVICE']) });
export const pcAuthStartSchema = z.object({ authorizeUrl: z.string().url() });
export const pcConnectionInputSchema = z.strictObject({ enabledCapabilities: z.array(pcCapabilitySchema).max(3) })
  .refine(value => new Set(value.enabledCapabilities).size === value.enabledCapabilities.length,
    { message: 'Capabilities must be unique', path: ['enabledCapabilities'] });
export const pcMessagesQuerySchema = paginationQuerySchema.extend({ numberId: uuidSchema.optional() });
export const pcReadInputSchema = z.strictObject({ ids: z.array(z.string().min(1).max(200)).min(1).max(100) });
export const pcWaitInputSchema = z.strictObject({ numberId: uuidSchema.nullable(), waiting: z.boolean() });
export const pcWaitSchema = z.object({ waitingUntil: timestampSchema.nullable() });
export type PcCapability = z.infer<typeof pcCapabilitySchema>;
export type PcConnection = z.infer<typeof pcConnectionSchema>;
export type PcNumber = z.infer<typeof pcNumberSchema>;
export type PcPlan = z.infer<typeof pcPlanSchema>;
export type PcPlanInput = z.infer<typeof pcPlanInputSchema>;
export type PcMessage = z.infer<typeof pcMessageSchema>;
export type PcSession = z.infer<typeof pcSessionSchema>;
export type PcAuthStartInput = z.infer<typeof pcAuthStartInputSchema>;
