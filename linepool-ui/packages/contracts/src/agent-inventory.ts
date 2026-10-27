import { z } from 'zod';
import { paginationQuerySchema, regionIdSchema, serviceSchema, uuidSchema } from './primitives.js';
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
  // Admin listing only.
  email: z.string().optional(),
  balanceMinor: z.number().int().optional(),
  holdingCount: z.number().int().nonnegative().optional(),
});
export type Agent = z.infer<typeof agentSchema>;

export const subagentSchema = agentSchema.omit({ userId: true });
export type Subagent = z.infer<typeof subagentSchema>;
export const agentContextSchema = z.object({
  agent: agentSchema,
  capabilities: z.object({ manageSubagents: z.boolean(), transferHoldings: z.boolean() }),
});
export type AgentContext = z.infer<typeof agentContextSchema>;

export const agentMetricPeriodSchema = z.enum(['today', '7d', '30d']).default('7d');
export type AgentMetricPeriod = z.infer<typeof agentMetricPeriodSchema>;
const nullableAmountMinorSchema = amountMinorSchema.nullable();
const nullableProfitMinorSchema = z.number().int().nullable();
export const agentDashboardSchema = z.object({
  currency: currencySchema,
  costStatus: z.enum(['SYNCED', 'PENDING_SYNC', 'LOCAL_SIMULATED', 'UNAVAILABLE']),
  kpis: z.object({
    balance: nullableAmountMinorSchema, availableInventory: z.number().int().nonnegative().nullable(),
    assignedInventory: z.number().int().nonnegative().nullable(), currentInventory: z.number().int().nonnegative().nullable(),
    subagentCount: z.number().int().nonnegative().nullable(), customerCount: z.number().int().nonnegative().nullable(),
    todaySales: nullableAmountMinorSchema, todayProfit: nullableProfitMinorSchema,
    todayOrders: z.number().int().nonnegative().nullable(), todayCodes: z.number().int().nonnegative().nullable(),
  }),
  trend: z.array(z.object({ date: z.string(), salesMinor: nullableAmountMinorSchema, costMinor: nullableAmountMinorSchema, profitMinor: nullableProfitMinorSchema })),
  codeVolume: z.array(z.object({ bucket: z.string(), count: z.number().int().nonnegative(), platform: z.string().nullable() })),
  inventoryStatus: z.record(z.enum(['AVAILABLE', 'SELF_ASSIGNED', 'SUBAGENT_ASSIGNED', 'USED', 'EXPIRED', 'ERROR']), z.number().int().nonnegative()),
  serviceRanking: z.array(z.object({ service: z.string(), quantity: z.number().int().nonnegative(), salesMinor: amountMinorSchema, profitMinor: nullableProfitMinorSchema })),
  subagents: z.array(z.object({ agentId: uuidSchema, name: z.string(), salesMinor: nullableAmountMinorSchema, codeCount: z.number().int().nonnegative(), inventoryCount: z.number().int().nonnegative(), profitMinor: nullableProfitMinorSchema, lastActiveAt: timestamp.nullable() })).optional(),
});
export type AgentDashboard = z.infer<typeof agentDashboardSchema>;

export const subagentsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).default(''),
  status: z.union([z.literal(''), partyStatusSchema]).default(''),
});
export type SubagentsQuery = z.infer<typeof subagentsQuerySchema>;
export const createSubagentInputSchema = z.strictObject({
  userId: uuidSchema, name: z.string().trim().min(1).max(120), idempotencyKey: uuidSchema,
});
export const updateAgentNameInputSchema = z.strictObject({ name: z.string().trim().min(1).max(120) });
export type UpdateAgentNameInput = z.infer<typeof updateAgentNameInputSchema>;
export const subagentStatusInputSchema = z.strictObject({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: reasonSchema });


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
  service: serviceSchema.nullable().default(null),
  transferable: z.boolean().optional(),
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

export const holdingTransferSchema = z.object({
  id: uuidSchema, phoneNumber: z.string(), regionId: z.string(),
  startsAt: timestamp, expiresAt: timestamp.nullable(), transferredAt: timestamp,
  currentlyHeld: z.boolean(),
});
export type HoldingTransfer = z.infer<typeof holdingTransferSchema>;
export const transferableHoldingSchema = numberHoldingSchema.extend({ service: serviceSchema });
export type TransferableHolding = z.infer<typeof transferableHoldingSchema>;

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
  quantity: z.number().int().positive().default(1),
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
  idempotencyKey: uuidSchema.optional(),
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

export const agentInventoryQuerySchema = paginationQuerySchema.extend({
  status: z.union([z.literal(''), z.enum(['ACTIVE', 'SUSPENDED', 'RETIRED'])]).default(''),
  search: z.string().max(64).default(''),
  region: z.union([z.literal(''), regionIdSchema]).default(''),
  service: z.union([z.literal(''), serviceSchema]).default(''),
});
export type AgentInventoryQuery = z.infer<typeof agentInventoryQuerySchema>;

export const updateCustomerInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: reasonSchema,
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerInputSchema>;

export const ledgerQuerySchema = paginationQuerySchema.extend({ currency: currencySchema.default('USD') });
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

export const agentTransactionsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(64).default(''),
  kind: z.union([z.literal(''), z.enum(['PURCHASE', 'RENEW', 'TRANSFER', 'ADJUSTMENT'])]).default(''),
  status: z.union([z.literal(''), z.enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'])]).default(''),
});
export type AgentTransactionsQuery = z.infer<typeof agentTransactionsQuerySchema>;

export const agentStockQuerySchema = paginationQuerySchema.extend({
  status: z.union([z.literal(''), z.enum(['AVAILABLE', 'ALLOCATED', 'RELEASED'])]).default(''),
  search: z.string().trim().max(64).default(''),
  platform: z.union([z.literal(''), serviceSchema]).default(''),
  region: z.union([z.literal(''), regionIdSchema]).default(''),
});
export const agentStockCountsSchema = z.object({ AVAILABLE: z.number().int(), ALLOCATED: z.number().int(), RELEASED: z.number().int() });
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
export const assignHoldingInputSchema = z.strictObject({
  holdingId: uuidSchema,
  customerId: uuidSchema,
  startsAt: timestamp,
  expiresAt: timestamp,
  idempotencyKey: uuidSchema,
});
export type AssignHoldingInput = z.infer<typeof assignHoldingInputSchema>;

// FILTER selects every eligible holding across pages; the preview fingerprint freezes that set.
export const holdingBatchSelectionSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('IDS'), holdingIds: z.array(uuidSchema).min(1).max(10000).refine(ids => new Set(ids).size === ids.length, 'holdingIds must be unique') }),
  z.strictObject({ mode: z.literal('FILTER'), search: z.string().max(64).default(''),
    status: z.union([z.literal(''), z.enum(['ACTIVE', 'SUSPENDED', 'RETIRED'])]).default(''),
    region: z.union([z.literal(''), regionIdSchema]).default(''), service: z.union([z.literal(''), serviceSchema]).default('') }),
]);
export type HoldingBatchSelection = z.infer<typeof holdingBatchSelectionSchema>;
export const holdingBatchPreviewInputSchema = z.strictObject({
  selection: holdingBatchSelectionSchema, recipient: ownerRefSchema, expiresAt: timestamp.nullable().default(null),
});
export type HoldingBatchPreviewInput = z.infer<typeof holdingBatchPreviewInputSchema>;
export const holdingBatchInputSchema = holdingBatchPreviewInputSchema.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), idempotencyKey: uuidSchema,
});
export type HoldingBatchInput = z.infer<typeof holdingBatchInputSchema>;
export const holdingBatchPreviewSchema = z.object({
  fingerprint: z.string(), count: z.number().int().positive().max(10000),
  sample: z.array(z.string()), earliestExpiresAt: timestamp, latestStartsAt: timestamp,
  regions: z.array(z.object({ value: z.string(), count: z.number().int().positive() })),
  services: z.array(z.object({ value: z.string(), count: z.number().int().positive() })),
});
export type HoldingBatchPreview = z.infer<typeof holdingBatchPreviewSchema>;
export const holdingBatchResultSchema = z.object({
  orderId: uuidSchema, count: z.number().int().positive(), replayed: z.boolean(),
});
export type HoldingBatchResult = z.infer<typeof holdingBatchResultSchema>;
export const agentStatusInputSchema = z.strictObject({ status: partyStatusSchema, reason: reasonSchema });
export type AgentStatusInput = z.infer<typeof agentStatusInputSchema>;
