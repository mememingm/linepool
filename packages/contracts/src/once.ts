import { z } from 'zod';

export const onceScenarioSchema = z.enum(['SUCCESS', 'FAILURE', 'UNKNOWN_SUCCESS', 'UNKNOWN_FAILURE']);
export const onceRequestKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
export const onceOutboundKeySchema = z.string().min(1).max(120).regex(/^[\x20-\x7e]+$/);
export const onceTermSchema = z.coerce.number().int().min(1).max(365);
export const onceRenewInputSchema = z.strictObject({
  term: onceTermSchema,
  quoteVersion: z.coerce.number().int().positive().max(2147483647),
  purchaseIntentId: z.uuid().optional(),
});
export const onceRentInputSchema = onceRenewInputSchema.extend({ number: z.string().trim().regex(/^\+[1-9]\d{6,14}$/) });
export const onceMockOrderInputSchema = onceRentInputSchema.extend({ scenario: onceScenarioSchema });
export const onceHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().min(1).max(1024).optional(),
});
export const onceOrderHistoryQuerySchema = onceHistoryQuerySchema.extend({ leaseId: z.uuid().optional() });
export const onceChatQuerySchema = onceHistoryQuerySchema.extend({ peer: z.string().max(120).optional() });
export const onceSendInputSchema = z.strictObject({
  to: z.string().max(32).regex(/^\+[1-9][0-9 ()-]{1,30}$/),
  content: z.string().min(1).max(4000).regex(/\S/),
});
export const onceReadInputSchema = z.strictObject({ ids: z.array(z.uuid()).min(1).max(200) });
export const onceMockEventInputSchema = z.strictObject({
  eventId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  leaseId: z.uuid(),
  providerMessageId: z.string().min(1).max(128),
  sender: z.string().min(1).max(120),
  title: z.string().max(200),
  body: z.string().max(12000),
  code: z.string().max(64).optional(),
  receivedAt: z.iso.datetime({ offset: true }),
});
export const onceIntentInputSchema = z.discriminatedUnion('kind', [
  onceRentInputSchema.omit({ purchaseIntentId: true }).extend({ kind: z.literal('RENT') }),
  onceRenewInputSchema.omit({ purchaseIntentId: true }).extend({ kind: z.literal('RENEW'), leaseId: z.uuid() }),
]);
export const onceReasonSchema = z.string().trim().min(2).max(500);
export const onceReasonInputSchema = z.strictObject({ reason: onceReasonSchema });
export type OnceScenario = z.infer<typeof onceScenarioSchema>;
export type OnceRentInput = z.infer<typeof onceRentInputSchema>;
export type OnceRenewInput = z.infer<typeof onceRenewInputSchema>;
export type OnceIntentInput = z.infer<typeof onceIntentInputSchema>;
export type OnceHistoryQuery = z.infer<typeof onceHistoryQuerySchema>;
export type OnceOrderHistoryQuery = z.infer<typeof onceOrderHistoryQuerySchema>;
export type OnceChatQuery = z.infer<typeof onceChatQuerySchema>;
export type OnceSendInput = z.infer<typeof onceSendInputSchema>;
export type OnceMockEventInput = z.infer<typeof onceMockEventInputSchema>;
export type OnceLeaseStatus = 'ACTIVE' | 'EXPIRED_HELD' | 'RELEASED' | 'ENDED';
export type OncePurchaseStatus = 'PENDING' | 'PROCESSING' | 'UNCERTAIN' | 'DEMO_CONFIRMED' | 'COMPLETED' | 'FAILED';
/** Service periods grant local access only; they never extend the upstream PC resource. */
export type OnceLeasePeriod = {
  id: string; orderId: string; assignedAt: string; expiresAt: string;
  releasedAt: string | null; releaseReason: string | null;
};
