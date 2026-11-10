import { z } from 'zod';
import { paginationQuerySchema, regionIdSchema, serviceSchema, uuidSchema, planIdSchema, fulfillmentStatusSchema, passwordSchema } from './primitives.js';
import { receivingModeSchema, receivingStatusSchema } from './receiving.js';
export { platformCodeRuleInputSchema, platformCodeRuleSchema, receivingReviewInputSchema, receivingReviewViewSchema, receivingReviewResultSchema,
  type PlatformCodeRuleInput, type PlatformCodeRule, type ReceivingReviewInput, type ReceivingReviewView, type ReceivingReviewResult } from './receiving.js';

export const adminQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).default(''),
  status: z.string().max(40).default(''),
  view: z.enum(['today', 'attention']).optional(),
  region: regionIdSchema.optional(),
  userId: uuidSchema.optional(),
  provider: z.enum(['pingcode', 'pingcode-mock']).optional(),
});
export const adminOrderViewSchema = z.enum(['today', 'attention']);
/** Old dashboard links remain usable; fulfillment status and list view are independent. */
export const adminOrdersQuerySchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || !('status' in value)) return value;
  const legacy = value.status === 'today' ? 'today' : ['EXCEPTION', 'UNVERIFIED'].includes(String(value.status)) ? 'attention' : undefined;
  return legacy ? { ...value, status: '', view: 'view' in value && value.view ? value.view : legacy } : value;
}, adminQuerySchema.extend({
  status: z.enum(['', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).default(''),
  view: adminOrderViewSchema.optional(),
}));
export type AdminOrdersQuery = z.infer<typeof adminOrdersQuerySchema>;
export const serviceDurationSchema = z.union([z.literal(7), z.literal(30)]);
export const reasonSchema = z.string().trim().min(3).max(500);
export const adminPasswordResetInputSchema = z.strictObject({ newPassword: passwordSchema, reason: reasonSchema });
export type AdminPasswordResetInput = z.infer<typeof adminPasswordResetInputSchema>;
export const userStatusInputSchema = z.strictObject({ status: z.enum(['ACTIVE', 'DISABLED']), reason: reasonSchema });
export const numberActionInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('assign'), userId: uuidSchema, durationDays: serviceDurationSchema, reason: reasonSchema }),
  z.strictObject({ action: z.literal('reclaim'), expectedUserId: uuidSchema, expectedAllocationId: uuidSchema, reason: reasonSchema }),
  z.strictObject({ action: z.literal('sale'), saleEnabled: z.boolean(), reason: reasonSchema }),
]);
export const productInputSchema = z.strictObject({
  region: regionIdSchema, service: serviceSchema, plan: planIdSchema,
  name: z.string().trim().min(1).max(100), receivingMode: receivingModeSchema.default('HOSTED'),
  durationDays: serviceDurationSchema.nullable(), windowMinutes: z.literal(15).nullable().default(null),
  unitPoints: z.number().int().min(1).max(1000000), isActive: z.boolean(),
  areaPrefix: z.string().trim().max(20).regex(/^\+?\d*$/),
  capability: z.literal('RECEIVE'),
  allowRenewal: z.literal(false), reason: reasonSchema,
}).refine(input => input.receivingMode === 'ONE_TIME' ? input.durationDays === null && input.windowMinutes === 15 : input.durationDays !== null && input.windowMinutes === null,
  { message: 'Choose a 15-minute one-time window or a complete 7/30-day hosted period', path: ['durationDays'] });
const date = z.string();
export const adminUserSchema = z.object({
  id: uuidSchema, email: z.string(), display_name: z.string(), role: z.enum(['USER', 'ADMIN']),
  auth_kind: z.enum(['LOCAL', 'PINCLODE']).default('LOCAL'),
  account_status: z.enum(['ACTIVE', 'DISABLED']), created_at: date, points_balance: z.number(),
  is_demo: z.boolean(), number_count: z.number(), order_count: z.number(),
});
export const adminNumberSchema = z.object({
  id: uuidSchema, number_id: uuidSchema, phone_number: z.string(), region_id: regionIdSchema, country: z.string(), prefix: z.string(),
  provider: z.enum(['pingcode', 'pingcode-mock']), external_number_id: z.string().nullable(),
  external_project_id: z.string(), project_name: z.string(), resource_expires_at: date.nullable(),
  service: serviceSchema, capability: z.string(), resource_status: z.string(), sale_enabled: z.boolean(),
  sale_status: z.string(), assigned_user_id: uuidSchema.nullable(), owner_name: z.string().nullable(),
  allocation_id: uuidSchema.nullable(),
  order_id: uuidSchema.nullable(), expires_at: date.nullable(),
  receiving_mode: receivingModeSchema.default('HOSTED'), receiving_status: receivingStatusSchema.nullable().default(null),
  first_message_id: uuidSchema.nullable().default(null), permanently_sold: z.boolean().default(false),
});
export const adminProductSchema = z.object({
  region_id: regionIdSchema, service: serviceSchema, plan: planIdSchema, name: z.string(),
  receiving_mode: receivingModeSchema.default('HOSTED'), window_minutes: z.literal(15).nullable().default(null),
  duration_days: z.number().nullable(), unit_points: z.number(), is_active: z.boolean(), country: z.string(),
  area_prefix: z.string(), capability: z.literal('RECEIVE'),
  allow_renewal: z.boolean(), available_count: z.number(), pc_available_count: z.number(),
  pc_project_id: z.string().nullable(), pc_project_name: z.string().nullable(),
});
export const adminOrderSchema = z.object({
  id: uuidSchema, order_number: z.string(), user_id: uuidSchema, owner_name: z.string(),
  plan_name: z.string(), quantity: z.number(), total_points: z.number(), created_at: date,
  payment_status: z.string(), fulfillment_status: fulfillmentStatusSchema, completed_at: date.nullable(),
  is_demo: z.boolean(), assigned_count: z.number(),
  receiving_mode: receivingModeSchema.default('HOSTED'), receiving_status: receivingStatusSchema.nullable().default(null),
  first_message_id: uuidSchema.nullable().default(null),
});
export const allocationSchema = z.object({
  id: uuidSchema, number_id: uuidSchema, platform_id: serviceSchema, user_id: uuidSchema, order_id: uuidSchema.nullable(),
  phone_number: z.string(), owner_name: z.string(), assigned_at: date, expires_at: date, released_at: date.nullable(),
  receiving_mode: receivingModeSchema.default('HOSTED'), receiving_status: receivingStatusSchema.nullable().default(null),
  first_message_id: uuidSchema.nullable().default(null),
  receiving_started_at: date.nullable().default(null), receiving_ends_at: date.nullable().default(null),
});
export const auditSchema = z.object({
  id: uuidSchema, actor_name: z.string(), action: z.string(), target_id: z.string(),
  reason: z.string(), before_data: z.unknown(), after_data: z.unknown(), created_at: date,
});
export const adminProjectSchema = z.object({
  provider: z.enum(['pingcode', 'pingcode-mock']), external_project_id: z.string(),
  project_name: z.string(), platform_id: serviceSchema, platform_name: z.string(),
  is_active: z.boolean(), synced_at: date, number_count: z.number(),
});
export const adminReceiptSchema = z.object({
  provider: z.enum(['pingcode', 'pingcode-mock']), external_message_id: z.string(),
  external_project_id: z.string().nullable(), external_number_id: z.string().nullable(),
  platform: z.string().nullable(), phone_number: z.string().nullable(), owner_name: z.string().nullable(),
  sender: z.string().nullable(), body: z.string().nullable(), sms_received_at: date.nullable(),
  recorded_at: date, processed_at: date.nullable(),
  processing_status: z.enum(['PENDING', 'IMPORTED', 'CONNECTION_IMPORTED', 'UNMATCHED', 'FAILED', 'QUARANTINED']), failure_reason: z.string().nullable(),
  event_id: z.string().nullable(), delivery_count: z.number(),
});
export const adminWebhookRetryInputSchema = z.strictObject({
  messageId: z.string().trim().min(1).max(200), reason: reasonSchema,
});
export const adminWebhookRetryResultSchema = z.object({ status: z.enum(['IMPORTED', 'UNMATCHED']) });
export const adminUpstreamStatusSchema = z.object({
  environment: z.enum(['development', 'production', 'test']),
  providerTransport: z.literal('mock'),
  webhook: z.object({
    path: z.literal('/api/webhooks/pingcode'), secretConfigured: z.boolean(),
    replayWindowSeconds: z.number().int().positive(), retryIntervalSeconds: z.number().int().positive(),
  }),
  receipts: z.object({
    total: z.number().int().nonnegative(), imported: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(), unmatched: z.number().int().nonnegative(),
    lastReceivedAt: date.nullable(), lastProcessedAt: date.nullable(),
    eventCount: z.number().int().nonnegative(), deliveryCount: z.number().int().nonnegative(),
    redeliveryCount: z.number().int().nonnegative(),
  }),
});
export type AdminUpstreamStatus = z.infer<typeof adminUpstreamStatusSchema>;
export type AdminWebhookRetryInput = z.infer<typeof adminWebhookRetryInputSchema>;
export const adminSummarySchema = z.object({
  users: z.number(), activeNumbers: z.number(), saleNumbers: z.number(), expiringNumbers: z.number(),
  pcSaleNumbers: z.number(), demoSaleNumbers: z.number(),
  todayOrders: z.number(),
  recentOrders: z.array(adminOrderSchema), expiring: z.array(adminNumberSchema),
  recentAudit: z.array(auditSchema), exceptionOrders: z.number(),
});
/** A country × platform combination that upstream projects actually provide numbers for. */
export const productOptionSchema = z.object({
  region: regionIdSchema, country: z.string(), service: serviceSchema,
  numberCount: z.number().int().nonnegative(), availableCount: z.number().int().nonnegative(), productCount: z.number().int().nonnegative(),
});
export const productSyncInputSchema = z.strictObject({ reason: reasonSchema });
export const productSyncResultSchema = z.object({
  optionCount: z.number().int().nonnegative(), createdCount: z.number().int().nonnegative(),
  created: z.array(z.object({ region: regionIdSchema, service: serviceSchema, plan: planIdSchema, name: z.string() })),
});
export type ProductOption = z.infer<typeof productOptionSchema>;
export type ProductSyncInput = z.infer<typeof productSyncInputSchema>;
export type AdminQuery = z.infer<typeof adminQuerySchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminNumber = z.infer<typeof adminNumberSchema>;
export type AdminProduct = z.infer<typeof adminProductSchema>;
export type AdminOrder = z.infer<typeof adminOrderSchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type AdminAudit = z.infer<typeof auditSchema>;
export type AdminProject = z.infer<typeof adminProjectSchema>;
export type AdminReceipt = z.infer<typeof adminReceiptSchema>;
export type AdminSummary = z.infer<typeof adminSummarySchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type NumberActionInput = z.infer<typeof numberActionInputSchema>;
export type UserStatusInput = z.infer<typeof userStatusInputSchema>;

/** Administrator-defined platforms. The id is permanent; name and listing state can change. */
export const platformInputSchema = z.strictObject({
  id: serviceSchema, name: z.string().trim().min(1).max(80), isActive: z.boolean(), reason: reasonSchema,
});
export const adminPlatformSchema = z.object({
  id: serviceSchema, name: z.string(), isActive: z.boolean(), createdAt: z.string(),
  activeProducts: z.number().int(), availableSlots: z.number().int(), codeRuleEnabled: z.boolean(),
});
export type PlatformInput = z.infer<typeof platformInputSchema>;
export type AdminPlatform = z.infer<typeof adminPlatformSchema>;

/** Unified agent model: the official storefront sells the numbers of the agent behind the ACTIVE OFFICIAL shop. */
export const officialShopInputSchema = z.strictObject({ agentId: uuidSchema, reason: reasonSchema });
export const adminShopAgentSchema = z.object({
  agentId: uuidSchema, displayName: z.string(), role: z.enum(['USER', 'ADMIN']), externalAccountId: z.string(),
  connectionId: uuidSchema, authStatus: z.string(), numbers: z.number().int(), lastSyncedAt: z.string().nullable(),
});
export const adminShopsSchema = z.object({
  official: z.object({ shopId: uuidSchema, agentId: uuidSchema, displayName: z.string(), externalAccountId: z.string(),
    connectionId: uuidSchema, createdAt: z.string(), availableSlots: z.number().int() }).nullable(),
  candidates: z.array(adminShopAgentSchema),
});
export type OfficialShopInput = z.infer<typeof officialShopInputSchema>;
export type AdminShops = z.infer<typeof adminShopsSchema>;

/** Shop pricing: a shop's agent lists its own hosted receiving products, priced in site points. */
export const shopProductInputSchema = z.strictObject({
  region: regionIdSchema, platformId: serviceSchema, durationDays: z.union([z.literal(7), z.literal(30)]),
  name: z.string().trim().min(1).max(120), unitPoints: z.number().int().min(1).max(1000000), isActive: z.boolean(),
});
export const shopProductSchema = z.object({
  id: uuidSchema, shopId: uuidSchema, region: regionIdSchema, platformId: serviceSchema, platformName: z.string(),
  durationDays: z.number().int(), plan: z.string(), name: z.string(), unitPoints: z.number().int(),
  isActive: z.boolean(), adminHold: z.boolean(), adminHoldReason: z.string().nullable(), version: z.number().int(),
  availableCount: z.number().int(), updatedAt: z.string(),
});
export const agentShopSchema = z.object({
  shop: z.object({ id: uuidSchema, kind: z.enum(['OFFICIAL', 'AGENT']) }).nullable(),
  products: z.array(shopProductSchema),
  platforms: z.array(z.object({ id: serviceSchema, name: z.string() })),
  regions: z.array(regionIdSchema),
});
export const adminShopProductSchema = shopProductSchema.extend({ shopKind: z.enum(['OFFICIAL', 'AGENT']), agentName: z.string() });
export const shopProductHoldInputSchema = z.strictObject({ hold: z.boolean(), reason: reasonSchema });
export type ShopProductInput = z.infer<typeof shopProductInputSchema>;
export type ShopProduct = z.infer<typeof shopProductSchema>;
export type AgentShop = z.infer<typeof agentShopSchema>;
export type AdminShopProduct = z.infer<typeof adminShopProductSchema>;
export type ShopProductHoldInput = z.infer<typeof shopProductHoldInputSchema>;

/** Immutable outcome of routing one agent-connection SMS to a shop buyer. */
export const shopDeliveryOutcomeSchema = z.enum(['DELIVERED', 'UNMATCHED', 'AMBIGUOUS', 'NO_BUYER']);
export const adminShopDeliveryQuerySchema = paginationQuerySchema.extend({
  outcome: shopDeliveryOutcomeSchema.optional(),
});
export const adminShopDeliverySchema = z.object({
  provider: z.enum(['pingcode', 'pingcode-mock']),
  externalMessageId: z.string(),
  shopId: uuidSchema,
  connectionId: uuidSchema,
  numberId: uuidSchema,
  phoneNumber: z.string().nullable(),
  sender: z.string().nullable(),
  platformId: serviceSchema.nullable(),
  platformName: z.string().nullable(),
  outcome: shopDeliveryOutcomeSchema,
  ruleVersion: z.number().int().nullable(),
  allocationId: uuidSchema.nullable(),
  smsMessageId: uuidSchema.nullable(),
  buyerName: z.string().nullable(),
  buyerEmail: z.string().nullable(),
  occurredAt: z.string(),
  createdAt: z.string(),
});
export const adminShopDeliveryPageSchema = z.object({
  data: z.array(adminShopDeliverySchema),
  pagination: z.object({
    page: z.number().int().positive(), pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(),
  }),
});
export type ShopDeliveryOutcome = z.infer<typeof shopDeliveryOutcomeSchema>;
export type AdminShopDeliveryQuery = z.infer<typeof adminShopDeliveryQuerySchema>;
export type AdminShopDelivery = z.infer<typeof adminShopDeliverySchema>;
export type AdminShopDeliveryPage = z.infer<typeof adminShopDeliveryPageSchema>;

export const shopDeliveryAttemptStatusSchema = z.enum(['RETRYING', 'FAILED']);
export const adminShopDeliveryAttemptQuerySchema = paginationQuerySchema.extend({
  status: shopDeliveryAttemptStatusSchema.optional(),
});
export const adminShopDeliveryAttemptSchema = z.object({
  provider: z.enum(['pingcode', 'pingcode-mock']),
  externalMessageId: z.string(),
  connectionId: uuidSchema,
  numberId: uuidSchema,
  phoneNumber: z.string().nullable(),
  sender: z.string().nullable(),
  attempts: z.number().int().positive(),
  lastError: z.string(),
  status: shopDeliveryAttemptStatusSchema,
  nextAttemptAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const adminShopDeliveryAttemptPageSchema = z.object({
  data: z.array(adminShopDeliveryAttemptSchema),
  pagination: z.object({
    page: z.number().int().positive(), pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(),
  }),
});
export const shopDeliveryRetryResultSchema = z.object({ changed: z.boolean() });
export type ShopDeliveryAttemptStatus = z.infer<typeof shopDeliveryAttemptStatusSchema>;
export type AdminShopDeliveryAttemptQuery = z.infer<typeof adminShopDeliveryAttemptQuerySchema>;
export type AdminShopDeliveryAttempt = z.infer<typeof adminShopDeliveryAttemptSchema>;
export type AdminShopDeliveryAttemptPage = z.infer<typeof adminShopDeliveryAttemptPageSchema>;
