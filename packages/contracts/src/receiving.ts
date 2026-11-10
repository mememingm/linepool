import { z } from 'zod';
import { uuidSchema, timestampSchema, serviceSchema } from './primitives.js';

export const receivingModeSchema = z.enum(['ONE_TIME', 'HOSTED']);
export const receivingStatusSchema = z.enum(['WAITING', 'SUCCESS', 'FAILED']);
/** Exact sender + complete literal body template; the only variable is one numeric code. */
export const platformCodeRuleShapeSchema = z.strictObject({
  senderAllowlist: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  bodyKeywords: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  bodyPrefix: z.string().max(4000), bodySuffix: z.string().max(4000),
  codeLength: z.number().int().min(4).max(8),
}).refine(rule => /[\p{L}]/u.test(rule.bodyPrefix + rule.bodySuffix) && (rule.bodyPrefix + rule.bodySuffix).trim().length >= 3,
  { message: 'A platform-specific literal message template is required', path: ['bodyPrefix'] });
export const platformCodeRuleInputSchema = z.strictObject({
  enabled: z.boolean(), rule: platformCodeRuleShapeSchema,
  reason: z.string().trim().min(3).max(500),
});
export const platformCodeRuleSchema = z.object({
  platformId: serviceSchema, enabled: z.boolean(), version: z.number().int().positive(),
  rule: platformCodeRuleShapeSchema, updatedAt: timestampSchema,
});
export const receivingReviewScopeSchema = z.object({
  allocationId: uuidSchema, orderId: uuidSchema, connectionId: uuidSchema,
  provider: z.enum(['pingcode', 'pingcode-mock']), externalNumberId: z.string(),
  externalProjectId: z.string(), phoneNumber: z.string(), platformId: serviceSchema,
  windowStart: timestampSchema, windowEnd: timestampSchema,
});
export const receivingReviewInputSchema = z.strictObject({
  localEvidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.enum(['EXTERNAL_PC_REVIEW', 'MOCK_SOURCE_REVIEW']),
  sourceReference: z.string().trim().min(3).max(1000),
  reviewedAt: timestampSchema,
  scope: receivingReviewScopeSchema,
  completeWindowReviewed: z.literal(true), noValidCodeConfirmed: z.literal(true),
  reason: z.string().trim().min(3).max(500),
});
export const receivingReviewViewSchema = z.object({
  scope: receivingReviewScopeSchema, receivingStatus: receivingStatusSchema,
  firstMessageId: uuidSchema.nullable(), localEvidenceDigest: z.string(),
  localEvents: z.array(z.object({ id: uuidSchema, status: z.string(), reason: z.string().nullable(), payload: z.unknown() })),
  localReceipts: z.array(z.object({ id: z.string(), status: z.string(), reason: z.string().nullable(), payload: z.unknown() })),
  localConflicts: z.array(z.object({ id: uuidSchema, reason: z.string(), payload: z.unknown() })),
  blockers: z.array(z.string()),
});
export const receivingReviewResultSchema = z.object({
  allocationId: uuidSchema, receivingStatus: receivingStatusSchema,
  firstMessageId: uuidSchema.nullable(), reviewId: uuidSchema.nullable(),
});
export type ReceivingMode = z.infer<typeof receivingModeSchema>;
export type ReceivingStatus = z.infer<typeof receivingStatusSchema>;
export type PlatformCodeRuleShape = z.infer<typeof platformCodeRuleShapeSchema>;
export type PlatformCodeRuleInput = z.infer<typeof platformCodeRuleInputSchema>;
export type PlatformCodeRule = z.infer<typeof platformCodeRuleSchema>;
export type ReceivingReviewInput = z.infer<typeof receivingReviewInputSchema>;
export type ReceivingReviewView = z.infer<typeof receivingReviewViewSchema>;
export type ReceivingReviewResult = z.infer<typeof receivingReviewResultSchema>;
