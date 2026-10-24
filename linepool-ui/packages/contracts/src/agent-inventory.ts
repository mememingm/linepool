import { z } from 'zod';
import { paginationQuerySchema, serviceSchema, uuidSchema } from './primitives.js';
import { reasonSchema } from './admin.js';

const timestamp = z.string().datetime({ offset: true });
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const amountMinorSchema = z.number().int().nonnegative();
const ownerTypeSchema = z.enum(['AGENT', 'CUSTOMER']);
export const ownerRefSchema = z.union([
  z.strictObject({ ownerType: z.literal('AGENT'), agentId: uuidSchema, customerId: z.never().optional() }),
  z.strictObject({ ownerType: z.literal('CUSTOMER'), customerId: uuidSchema, agentId: z.never().optional() }),
]);
export type OwnerRef = z.infer<typeof ownerRefSchema>;
export function ownerKey(owner: OwnerRef): { ownerType: 'AGENT' | 'CUSTOMER'; agentId: string | null; customerId: string | null } {
  return owner.ownerType === 'AGENT'
    ? { ownerType: 'AGENT', agentId: owner.agentId, customerId: null }
    : { ownerType: 'CUSTOMER', agentId: null, customerId: owner.customerId };
}
const partyStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'TERMINATED']);
const pricingKindSchema = z.enum(['WHOLESALE', 'RETAIL']);

export const agentSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  parentAgentId: uuidSchema.nullable(),
  name: z.string().min(1).max(120),
  level: z.number().int().min(1).max(10),
  status: partyStatusSchema,
  createdAt: timestamp,
});
export type Agent = z.infer<typeof agentSchema>;

export const customerSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  agentId: uuidSchema.nullable(),
  name: z.string().min(1).max(120),
  status: partyStatusSchema,
  createdAt: timestamp,
});
export type Customer = z.infer<typeof customerSchema>;

export const balanceAccountSchema = z.object({
  id: uuidSchema,
  ownerType: ownerTypeSchema,
  agentId: uuidSchema.nullable(),
  customerId: uuidSchema.nullable(),
  currency: currencySchema,
  balanceMinor: amountMinorSchema,
  version: z.number().int().nonnegative(),
  createdAt: timestamp,
});
export type BalanceAccount = z.infer<typeof balanceAccountSchema>;

export const numberHoldingSchema = z.object({
  id: uuidSchema,
  ownerType: ownerTypeSchema,
  agentId: uuidSchema.nullable(),
  customerId: uuidSchema.nullable(),
  regionId: z.string(),
  phoneNumber: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'RETIRED']),
  sourceTxOrderId: uuidSchema.nullable(),
  sourceHoldingId: uuidSchema.nullable(),
  startsAt: timestamp,
  expiresAt: timestamp.nullable(),
  transferredAt: timestamp.nullable(),
  acquiredAt: timestamp,
  createdAt: timestamp,
});
export type NumberHolding = z.infer<typeof numberHoldingSchema>;

export const serviceEntitlementSchema = z.object({
  id: uuidSchema,
  holdingId: uuidSchema,
  service: z.string().min(1),
  startsAt: timestamp,
  expiresAt: timestamp,
  status: z.enum(['ACTIVE', 'EXPIRED', 'REVOKED']),
  sourceTxOrderId: uuidSchema.nullable(),
  createdAt: timestamp,
});
export type ServiceEntitlement = z.infer<typeof serviceEntitlementSchema>;

export const priceRuleSchema = z.object({
  id: uuidSchema,
  pricingKind: pricingKindSchema,
  agentId: uuidSchema.nullable(),
  buyerAgentId: uuidSchema.nullable(),
  sellerAgentId: uuidSchema.nullable().default(null),
  regionId: z.string().nullable(),
  service: z.string().min(1),
  plan: z.string().min(1),
  currency: currencySchema,
  unitAmountMinor: z.number().int().positive(),
  priority: z.number().int().nonnegative(),
  isActive: z.boolean(),
  createdAt: timestamp,
});
export type PriceRule = z.infer<typeof priceRuleSchema>;

export const txOrderSchema = z.object({
  id: uuidSchema,
  orderNumber: z.string(),
  kind: z.enum(['PURCHASE', 'RENEW', 'TRANSFER', 'ADJUSTMENT']),
  buyerType: ownerTypeSchema,
  buyerAgentId: uuidSchema.nullable(),
  buyerCustomerId: uuidSchema.nullable(),
  sellerType: z.enum(['PLATFORM', 'AGENT']),
  sellerAgentId: uuidSchema.nullable(),
  recipientType: ownerTypeSchema.nullable().default(null),
  recipientAgentId: uuidSchema.nullable().default(null),
  recipientCustomerId: uuidSchema.nullable().default(null),
  pricingKind: pricingKindSchema,
  currency: currencySchema,
  amountMinor: amountMinorSchema,
  points: z.number().int().positive().nullable(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  sourceOrderId: uuidSchema.nullable(),
  createdAt: timestamp,
  completedAt: timestamp.nullable(),
});
export type TxOrder = z.infer<typeof txOrderSchema>;

export const balanceLedgerSchema = z.object({
  id: uuidSchema,
  accountId: uuidSchema,
  type: z.enum(['TOPUP', 'ORDER_DEBIT', 'COMMISSION', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT']),
  delta: z.number().int(),
  balanceAfter: amountMinorSchema,
  description: z.string(),
  txOrderId: uuidSchema.nullable(),
  createdAt: timestamp,
});
export type BalanceLedgerEntry = z.infer<typeof balanceLedgerSchema>;

export const createAgentInputSchema = z.strictObject({
  userId: uuidSchema,
  parentAgentId: uuidSchema.nullable().default(null),
  name: z.string().trim().min(1).max(120),
  level: z.number().int().min(1).max(2).default(1),
});
export type CreateAgentInput = z.infer<typeof createAgentInputSchema>;
export const createCustomerInputSchema = z.strictObject({
  userId: uuidSchema,
  agentId: uuidSchema.nullable().default(null),
  name: z.string().trim().min(1).max(120),
});
export type CreateCustomerInput = z.infer<typeof createCustomerInputSchema>;
export const createTxOrderInputSchema = z.strictObject({
  kind: z.enum(['PURCHASE', 'RENEW', 'TRANSFER', 'ADJUSTMENT']),
  buyerType: ownerTypeSchema,
  buyerAgentId: uuidSchema.optional(),
  buyerCustomerId: uuidSchema.optional(),
  pricingKind: pricingKindSchema,
  currency: currencySchema,
  idempotencyKey: uuidSchema.optional(),
}).refine(
  input => (input.buyerType === 'AGENT') === Boolean(input.buyerAgentId),
  { message: 'buyerAgentId is required for AGENT buyers only', path: ['buyerAgentId'] },
).refine(
  input => (input.buyerType === 'CUSTOMER') === Boolean(input.buyerCustomerId),
  { message: 'buyerCustomerId is required for CUSTOMER buyers only', path: ['buyerCustomerId'] },
);

export type CreateTxOrderInput = z.infer<typeof createTxOrderInputSchema>;

export const upsertPriceRuleInputSchema = z.strictObject({
  pricingKind: pricingKindSchema,
  agentId: uuidSchema.nullable().default(null),
  buyerAgentId: uuidSchema.nullable().default(null),
  regionId: z.string().nullable().default(null),
  service: z.string().trim().min(1).max(64),
  plan: z.string().trim().min(1).max(64),
  currency: currencySchema,
  unitAmountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  priority: z.number().int().nonnegative().max(100000).default(0),
  isActive: z.boolean().default(true),
});
export type UpsertPriceRuleInput = z.infer<typeof upsertPriceRuleInputSchema>;

export const transferBalanceInputSchema = z.strictObject({
  fromOwner: ownerRefSchema,
  toOwner: ownerRefSchema,
  currency: currencySchema,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  description: z.string().trim().min(1).max(200).optional(),
  idempotencyKey: uuidSchema,
});
export type TransferBalanceInput = z.infer<typeof transferBalanceInputSchema>;

export const createHoldingInputSchema = ownerRefSchema.and(z.strictObject({
  regionId: z.string().trim().min(1).max(32),
  phoneNumber: z.string().trim().min(5).max(32),
  service: z.string().trim().min(1).max(64),
  startsAt: timestamp,
  expiresAt: timestamp.nullable().default(null),
  idempotencyKey: uuidSchema,
}));
export type CreateHoldingInput = z.infer<typeof createHoldingInputSchema>;

export const adjustBalanceInputSchema = ownerRefSchema.and(z.strictObject({
  currency: currencySchema,
  direction: z.enum(['CREDIT', 'DEBIT']),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(3).max(200),
  idempotencyKey: uuidSchema,
}));
export type AdjustBalanceInput = z.infer<typeof adjustBalanceInputSchema>;

export const agentInventoryQuerySchema = z.object({
  status: z.union([z.literal(''), z.enum(['ACTIVE', 'SUSPENDED', 'RETIRED'])]).default(''),
  search: z.string().max(64).default(''),
});
export type AgentInventoryQuery = z.infer<typeof agentInventoryQuerySchema>;

export const agentTransactionsQuerySchema = paginationQuerySchema.extend({
  status: z.union([z.literal(''), z.enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'])]).default(''),
});
export type AgentTransactionsQuery = z.infer<typeof agentTransactionsQuerySchema>;

export const agentStockQuerySchema = z.object({
  status: z.union([z.literal(''), z.enum(['AVAILABLE', 'ALLOCATED', 'RELEASED'])]).default(''),
  search: z.string().trim().max(64).default(''),
});
export type AgentStockQuery = z.infer<typeof agentStockQuerySchema>;

const stockResourceStatusSchema = z.enum(['LOCAL', 'ONLINE', 'OFFLINE', 'ERROR']);
export const agentNumberStockSchema = z.object({
  id: uuidSchema,
  provider: z.literal('pingcode-mock'),
  platformId: serviceSchema,
  externalProjectId: z.string().min(1),
  externalNumberId: z.string().nullable(),
  phoneNumber: z.string(),
  regionId: z.string(),
  resourceStatus: stockResourceStatusSchema,
  status: z.enum(['AVAILABLE', 'ALLOCATED', 'RELEASED']),
  resourceExpiresAt: timestamp.nullable(),
  holdingId: uuidSchema.nullable(),
  importedAt: timestamp,
});
export type AgentNumberStock = z.infer<typeof agentNumberStockSchema>;

export const agentNumberImportRowSchema = z.strictObject({
  provider: z.literal('pingcode-mock').default('pingcode-mock'),
  platformId: serviceSchema,
  externalProjectId: z.string().trim().min(1).max(160),
  externalNumberId: z.string().trim().min(1).max(160).optional().default(''),
  phoneNumber: z.string().trim().regex(/^\+[1-9][0-9]{6,14}$/),
  regionId: z.string().trim().min(1).max(32),
  resourceStatus: stockResourceStatusSchema.default('LOCAL'),
  resourceExpiresAt: timestamp.nullable().default(null),
});
export type AgentNumberImportRow = z.infer<typeof agentNumberImportRowSchema>;
export const agentNumberImportInputSchema = z.strictObject({
  rows: z.array(agentNumberImportRowSchema).min(1).max(500),
  idempotencyKey: uuidSchema,
  reason: reasonSchema,
});
export type AgentNumberImportInput = z.infer<typeof agentNumberImportInputSchema>;

const holdingWindowSchema = z.strictObject({
  startsAt: timestamp,
  expiresAt: timestamp,
  service: serviceSchema.optional(),
});
export const claimAgentNumberInputSchema = z.strictObject({
  stockId: uuidSchema,
  agentId: uuidSchema.optional(),
  startsAt: timestamp,
  expiresAt: timestamp,
  service: serviceSchema.optional(),
  idempotencyKey: uuidSchema,
});
export type ClaimAgentNumberInput = z.infer<typeof claimAgentNumberInputSchema>;
export const claimAgentNumbersInputSchema = z.strictObject({
  stockIds: z.array(uuidSchema).min(1).max(100).refine(ids => new Set(ids).size === ids.length, 'stockIds must be unique'),
  agentId: uuidSchema.optional(),
  startsAt: timestamp,
  expiresAt: timestamp,
  service: serviceSchema.optional(),
  idempotencyKey: uuidSchema,
});
export type ClaimAgentNumbersInput = z.infer<typeof claimAgentNumbersInputSchema>;
export const releaseHoldingInputSchema = z.strictObject({
  reason: reasonSchema,
  idempotencyKey: uuidSchema,
});
export type ReleaseHoldingInput = z.infer<typeof releaseHoldingInputSchema>;
export const resellHoldingInputSchema = z.strictObject({
  holdingId: uuidSchema,
  toAgentId: uuidSchema,
  startsAt: timestamp,
  expiresAt: timestamp,
  idempotencyKey: uuidSchema,
});
export type ResellHoldingInput = z.infer<typeof resellHoldingInputSchema>;
export const agentStatusInputSchema = z.strictObject({ status: partyStatusSchema, reason: reasonSchema });
export type AgentStatusInput = z.infer<typeof agentStatusInputSchema>;
