import { z } from 'zod';

const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().datetime({ offset: true });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const paginationSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalItems: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

export const loginInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
});

export const userSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  displayName: z.string().min(1),
  isDemo: z.boolean(),
  pointsBalance: z.number().int().min(0),
  createdAt: isoDateSchema,
});

export const planSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  description: z.string(),
  unitPoints: z.number().int().positive(),
  durationDays: z.number().int().positive(),
  availableCount: z.number().int().min(0),
  isActive: z.boolean(),
});

export const projectSummarySchema = z.object({
  id: uuidSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  countryCode: z.string().length(2),
  countryName: z.string().min(1),
  description: z.string(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  isActive: z.boolean(),
  availableCount: z.number().int().min(0),
  minPoints: z.number().int().min(0),
});

export const projectDetailSchema = projectSummarySchema.extend({
  plans: z.array(planSchema),
});

export const orderStatusSchema = z.enum(['COMPLETED', 'CANCELLED']);

export const orderSummarySchema = z.object({
  id: uuidSchema,
  orderNumber: z.string().min(1),
  project: z.object({ id: uuidSchema, name: z.string().min(1) }),
  plan: z.object({ id: uuidSchema, name: z.string().min(1) }),
  quantity: z.number().int().positive(),
  totalPoints: z.number().int().positive(),
  status: orderStatusSchema,
  createdAt: isoDateSchema,
});

export const assignedNumberSchema = z.object({
  id: uuidSchema,
  phoneNumber: z.string().min(5),
  project: z.object({ id: uuidSchema, name: z.string().min(1) }),
  orderId: uuidSchema,
  status: z.enum(['ACTIVE', 'EXPIRED']),
  assignedAt: isoDateSchema,
  expiresAt: isoDateSchema,
});

export const orderDetailSchema = orderSummarySchema.extend({
  numbers: z.array(assignedNumberSchema),
});

export const createOrderInputSchema = z.object({
  projectId: uuidSchema,
  planId: uuidSchema,
  quantity: z.number().int().min(1).max(10),
  idempotencyKey: uuidSchema,
});

export const smsMessageSchema = z.object({
  id: uuidSchema,
  phoneNumberId: uuidSchema,
  phoneNumber: z.string().min(5),
  sender: z.string().min(1),
  body: z.string().min(1),
  verificationCode: z.string().nullable(),
  receivedAt: isoDateSchema,
  isRead: z.boolean(),
});

export const pointLedgerEntrySchema = z.object({
  id: uuidSchema,
  type: z.enum(['SEED_CREDIT', 'ORDER_DEBIT', 'ADJUSTMENT']),
  delta: z.number().int(),
  balanceAfter: z.number().int().min(0),
  description: z.string().min(1),
  referenceId: uuidSchema.nullable(),
  createdAt: isoDateSchema,
});

export const pointsOverviewSchema = z.object({
  balance: z.number().int().min(0),
  entries: z.array(pointLedgerEntrySchema),
});

export const dashboardSchema = z.object({
  pointsBalance: z.number().int().min(0),
  availableProjects: z.array(projectSummarySchema),
  recentOrders: z.array(orderSummarySchema),
});

export const accountSchema = userSchema.pick({
  id: true,
  email: true,
  displayName: true,
  isDemo: true,
  createdAt: true,
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type User = z.infer<typeof userSchema>;
export type Plan = z.infer<typeof planSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;
export type AssignedNumber = z.infer<typeof assignedNumberSchema>;
export type SmsMessage = z.infer<typeof smsMessageSchema>;
export type PointLedgerEntry = z.infer<typeof pointLedgerEntrySchema>;
export type PointsOverview = z.infer<typeof pointsOverviewSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type Account = z.infer<typeof accountSchema>;

export interface DataResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> extends DataResponse<T[]> {
  pagination: Pagination;
}

export interface PointsResponse extends DataResponse<PointsOverview> {
  pagination: Pagination;
}
