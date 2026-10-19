import { z } from 'zod';
import { paginationQuerySchema, regionIdSchema, serviceSchema, uuidSchema, planIdSchema, fulfillmentStatusSchema } from './index.js';

export const adminQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).default(''),
  status: z.string().max(40).default(''),
  region: regionIdSchema.optional(),
  userId: uuidSchema.optional(),
});
export const reasonSchema = z.string().trim().min(3).max(500);
export const userStatusInputSchema = z.strictObject({ status: z.enum(['ACTIVE', 'DISABLED']), reason: reasonSchema });
export const numberActionInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('assign'), userId: uuidSchema, durationDays: z.number().int().min(1).max(365), reason: reasonSchema }),
  z.strictObject({ action: z.literal('reclaim'), expectedUserId: uuidSchema, expectedAllocationId: uuidSchema, reason: reasonSchema }),
  z.strictObject({ action: z.literal('sale'), saleEnabled: z.boolean(), reason: reasonSchema }),
]);
export const productInputSchema = z.strictObject({
  region: regionIdSchema, service: serviceSchema, plan: planIdSchema,
  name: z.string().trim().min(1).max(100), durationDays: z.number().int().min(1).max(365),
  unitPoints: z.number().int().min(1).max(1000000), isActive: z.boolean(),
  areaPrefix: z.string().trim().max(20).regex(/^\+?\d*$/),
  capability: z.literal('RECEIVE'),
  allowRenewal: z.literal(false), reason: reasonSchema,
});
const date = z.string();
export const adminUserSchema = z.object({
  id: uuidSchema, email: z.string(), display_name: z.string(), role: z.enum(['USER', 'ADMIN']),
  account_status: z.enum(['ACTIVE', 'DISABLED']), created_at: date, points_balance: z.number(),
  is_demo: z.boolean(), number_count: z.number(), order_count: z.number(),
});
export const adminNumberSchema = z.object({
  id: uuidSchema, phone_number: z.string(), region_id: regionIdSchema, country: z.string(), prefix: z.string(),
  service: serviceSchema, capability: z.string(), resource_status: z.string(), sale_enabled: z.boolean(),
  sale_status: z.string(), assigned_user_id: uuidSchema.nullable(), owner_name: z.string().nullable(),
  allocation_id: uuidSchema.nullable(),
  order_id: uuidSchema.nullable(), expires_at: date.nullable(),
});
export const adminProductSchema = z.object({
  region_id: regionIdSchema, service: serviceSchema, plan: planIdSchema, name: z.string(),
  duration_days: z.number(), unit_points: z.number(), is_active: z.boolean(), country: z.string(),
  area_prefix: z.string(), capability: z.literal('RECEIVE'),
  allow_renewal: z.boolean(), available_count: z.number(),
});
export const adminOrderSchema = z.object({
  id: uuidSchema, order_number: z.string(), user_id: uuidSchema, owner_name: z.string(),
  plan_name: z.string(), quantity: z.number(), total_points: z.number(), created_at: date,
  payment_status: z.string(), fulfillment_status: fulfillmentStatusSchema, completed_at: date.nullable(),
  is_demo: z.boolean(), assigned_count: z.number(),
});
export const allocationSchema = z.object({
  id: uuidSchema, number_id: uuidSchema, user_id: uuidSchema, order_id: uuidSchema.nullable(),
  phone_number: z.string(), owner_name: z.string(), assigned_at: date, expires_at: date, released_at: date.nullable(),
});
export const auditSchema = z.object({
  id: uuidSchema, actor_name: z.string(), action: z.string(), target_id: z.string(),
  reason: z.string(), before_data: z.unknown(), after_data: z.unknown(), created_at: date,
});
export const adminSummarySchema = z.object({
  users: z.number(), activeNumbers: z.number(), saleNumbers: z.number(), expiringNumbers: z.number(),
  todayOrders: z.number(),
  recentOrders: z.array(adminOrderSchema), expiring: z.array(adminNumberSchema),
  recentAudit: z.array(auditSchema), exceptionOrders: z.number(),
});
export type AdminQuery = z.infer<typeof adminQuerySchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminNumber = z.infer<typeof adminNumberSchema>;
export type AdminProduct = z.infer<typeof adminProductSchema>;
export type AdminOrder = z.infer<typeof adminOrderSchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type AdminAudit = z.infer<typeof auditSchema>;
export type AdminSummary = z.infer<typeof adminSummarySchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type NumberActionInput = z.infer<typeof numberActionInputSchema>;
export type UserStatusInput = z.infer<typeof userStatusInputSchema>;
