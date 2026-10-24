import { z } from 'zod';
import { uuidSchema, timestampSchema, regionIdSchema, serviceSchema, planIdSchema, paginationQuerySchema } from './primitives.js';
export * from './primitives.js';
export * from './number-services.js';
export * from './platform-catalog.js';
export * from './recharge.js';
export * from './agent-inventory.js';

const timestamp = timestampSchema;
export const listQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).default(''),
  region: regionIdSchema.optional(),
});
export const numbersQuerySchema = listQuerySchema.extend({
  status: z.enum(['ACTIVE', 'EXPIRED', 'expiring']).optional(),
  numberId: uuidSchema.optional(),
  allocationId: uuidSchema.optional(),
});
export const inboxQuerySchema = listQuerySchema.extend({
  numberId: uuidSchema.optional(),
  allocationId: uuidSchema.optional(),
  messageId: uuidSchema.optional(),
  unread: z.enum(['true', 'false']).optional(),
});
export const pointsQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(['income', 'expense']).optional(),
});
export const paginationSchema = z.object({
  page: z.number().int().positive(), pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(),
});
export function dataResponseSchema<T extends z.ZodType>(schema: T) {
  return z.object({ data: schema });
}
export function paginatedResponseSchema<T extends z.ZodType>(schema: T) {
  return z.object({ data: z.array(schema), pagination: paginationSchema });
}
export const apiErrorSchema = z.object({ error: z.object({
  code: z.string(), message: z.string(), details: z.unknown().optional(),
}) });
const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const loginInputSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.union([emailSchema, z.literal('admin')])),
  password: z.string().min(8).max(72).refine(value => new TextEncoder().encode(value).length <= 72, 'Password must not exceed 72 UTF-8 bytes'),
});
export const registerInputSchema = loginInputSchema.extend({
  email: emailSchema,
  displayName: z.string().trim().min(1).max(80),
});
export const userSchema = z.object({
  id: uuidSchema, email: z.string().email(), displayName: z.string(),
  isDemo: z.boolean(), pointsBalance: z.number().int().nonnegative(), createdAt: timestamp,
  role: z.enum(['USER', 'ADMIN']).default('USER'),
});
export const preferencesSchema = z.object({
  expiryNotice: z.boolean(), language: z.literal('zh-CN'),
});
export const preferencesInputSchema = z.strictObject({ expiryNotice: z.boolean() });
export const contactPhoneSchema = z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'Use an international phone number, such as +8613812345678');
export const accountProfileInputSchema = z.discriminatedUnion('field', [
  z.strictObject({ field: z.literal('displayName'), displayName: registerInputSchema.shape.displayName }),
  z.strictObject({ field: z.literal('email'), email: emailSchema, currentPassword: loginInputSchema.shape.password }),
  z.strictObject({ field: z.literal('phoneNumber'), phoneNumber: contactPhoneSchema, currentPassword: loginInputSchema.shape.password }),
  z.strictObject({ field: z.literal('password'), newPassword: loginInputSchema.shape.password, currentPassword: loginInputSchema.shape.password }),
]);
export const accountSchema = userSchema.extend({ preferences: preferencesSchema, sandboxEnabled: z.boolean().optional(), phoneNumber: contactPhoneSchema.nullable().default(null) });
export const offerSchema = z.object({
  region: regionIdSchema, service: serviceSchema, plan: planIdSchema,
  name: z.string(), durationDays: z.number().int().positive(),
  unitPoints: z.number().int().positive(), availableCount: z.number().int().nonnegative(),
  areaCodes: z.array(z.object({ code: z.string().regex(/^[2-9]\d{2}$/), availableCount: z.number().int().nonnegative() })).optional(),
});
export const regionSchema = z.object({
  id: regionIdSchema, name: z.string(), english: z.string(), prefix: z.string(),
  area: z.string(), availableCount: z.number().int().nonnegative(),
});
export const catalogSchema = z.object({
  regions: z.array(regionSchema), services: z.array(serviceSchema), offers: z.array(offerSchema), isDemo: z.literal(true),
  platforms: z.array(z.object({ name: z.string(), slug: z.string(), popular: z.boolean(), available: z.boolean() })).optional(),
});
export const createOrderInputSchema = z.strictObject({
  region: regionIdSchema, service: serviceSchema, plan: planIdSchema,
  quantity: z.number().int().min(1).max(10), idempotencyKey: uuidSchema,
  areaCode: z.string().regex(/^[2-9]\d{2}$/).optional(),
}).refine(input => !input.areaCode || input.region === 'us', { message: 'Area code selection is only available for US numbers', path: ['areaCode'] });
export const numberSchema = z.object({
  id: uuidSchema, phoneNumber: z.string(), region: regionIdSchema, country: z.string(),
  service: serviceSchema, orderId: uuidSchema.nullable(), status: z.enum(['ACTIVE', 'EXPIRED']),
  allocationId: uuidSchema.optional(),
  assignedAt: timestamp, expiresAt: timestamp, remainingDays: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(), unreadCount: z.number().int().nonnegative(),
  isDemo: z.literal(true),
});
export const fulfillmentStatusSchema = z.enum(['PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']);
export const orderSchema = z.object({
  id: uuidSchema, orderNumber: z.string(), region: regionIdSchema, country: z.string(),
  service: serviceSchema, plan: planIdSchema, planName: z.string(),
  quantity: z.number().int().positive(), unitPoints: z.number().int().positive(),
  totalPoints: z.number().int().positive(), durationDays: z.number().int().positive(),
  status: fulfillmentStatusSchema, createdAt: timestamp, completedAt: timestamp.nullable().optional(), isDemo: z.literal(true),
  areaCode: z.string().nullable().optional(),
});
export const orderDetailSchema = orderSchema.extend({ numbers: z.array(numberSchema) });
export const smsSchema = z.object({
  id: uuidSchema, numberId: uuidSchema, phoneNumber: z.string(), sender: z.string(),
  allocationId: uuidSchema.nullable().optional(), platformId: serviceSchema.optional(),
  body: z.string(), verificationCode: z.string().nullable(), receivedAt: timestamp, isRead: z.boolean(),
});
export const markReadInputSchema = z.strictObject({ ids: z.array(uuidSchema).min(1).max(100) });
export const ledgerSchema = z.object({
  id: uuidSchema, type: z.enum(['SEED_CREDIT', 'ORDER_DEBIT', 'ADJUSTMENT']),
  delta: z.number().int(), balanceAfter: z.number().int().nonnegative(),
  description: z.string(), referenceId: uuidSchema.nullable(), createdAt: timestamp,
});
export const pointsResponseSchema = z.object({
  data: z.object({ balance: z.number().int().nonnegative(), income: z.number().int().nonnegative().optional(), expense: z.number().int().nonnegative().optional(), entries: z.array(ledgerSchema) }),
  pagination: paginationSchema,
});
export const dashboardSchema = z.object({
  pointsBalance: z.number().int().nonnegative(), activeNumbers: z.number().int().nonnegative(),
  expiringNumbers: z.number().int().nonnegative(), unreadMessages: z.number().int().nonnegative(),
  recentOrders: z.array(orderSchema),
  overview: z.object({
    totalNumbers: z.number().int().nonnegative(), totalMessages: z.number().int().nonnegative(), totalOrders: z.number().int().nonnegative(),
    receivedThisMonth: z.number().int().nonnegative(),
    recentNumbers: z.array(numberSchema), recentMessages: z.array(smsSchema),
    daily: z.array(z.object({ date: timestamp, messages: z.number().int().nonnegative(), numbers: z.number().int().nonnegative() })),
  }).optional(),
});
export type LoginInput = z.infer<typeof loginInputSchema>;
export type RegisterInput = z.infer<typeof registerInputSchema>;
export type User = z.infer<typeof userSchema>;
export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;
export type AssignedNumber = z.infer<typeof numberSchema>;
export type Order = z.infer<typeof orderSchema>;
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export type SmsMessage = z.infer<typeof smsSchema>;
export type LedgerEntry = z.infer<typeof ledgerSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type NumbersQuery = z.infer<typeof numbersQuerySchema>;
export type InboxQuery = z.infer<typeof inboxQuerySchema>;
export type PointsQuery = z.infer<typeof pointsQuerySchema>;
export type Account = z.infer<typeof accountSchema>;
export type AccountProfileInput = z.infer<typeof accountProfileInputSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type PaginatedResponse<T> = { data: T[]; pagination: z.infer<typeof paginationSchema> };
