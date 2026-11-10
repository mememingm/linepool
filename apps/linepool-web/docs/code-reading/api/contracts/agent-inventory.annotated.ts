/**
 * agent-inventory.ts 中文分区导读副本：代理库存、流转与结算契约
 * 原文件：packages/contracts/src/agent-inventory.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。多数规则使用 Zod 描述输入或返回格式，类型声明供编辑器检查。
 * 【整体用途】规定代理/客户资料、库存、持有记录、转移、报价、账本和批量操作的数据结构。
 * 【为什么这样组织】把身份、金额单位、允许动作和批量预览约定集中维护；前端校验后，后端仍要核对权限、价格与库存。
 * 【调用链】client.ts 的 agent 方法 → AgentInventoryController → AgentInventory / HoldingBatch / agent-settlement。
 * 【修改提示】金额字段 Minor 用最小货币单位整数；统计 7d/30d 不是套餐天数。扩大批量上限需同步后端选择上限、请求体大小与接口超时。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { z } from 'zod';
import { paginationQuerySchema, regionIdSchema, serviceSchema, uuidSchema } from '../../../../packages/contracts/src/primitives.js';
import { reasonSchema } from '../../../../packages/contracts/src/admin.js';

/**
 * ==================== 01 公共格式与持有人身份 ====================
 * timestamp = 时间格式规则。接口用带时区的时间文字传输，数据库 Date 需要先转为文字。
 */
const timestamp = z.string().datetime({ offset: true });
/**
 * currencySchema = 币种规则，例如 USD；这里只检查三个大写字母，具体业务支持还要看业务代码。
 */
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
/**
 * amountMinorSchema = 最小货币单位金额规则：非负整数。例如 USD 中 100 表示 1 美元。
 */
const amountMinorSchema = z.number().int().nonnegative();
/**
 * ownerTypeSchema = 持有人类别规则：AGENT 代理或 CUSTOMER 客户。
 */
const ownerTypeSchema = z.enum(['AGENT', 'CUSTOMER']);
/**
 * ownerRefSchema = 持有人身份引用。代理只能提供 agentId，客户只能提供 customerId，防止两种编号混用。
 * 字段速读：ownerType 持有人类别；agentId 代理编号；customerId 客户编号。
 */
export const ownerRefSchema = z.union([
  z.strictObject({ ownerType: z.literal('AGENT'), agentId: uuidSchema, customerId: z.never().optional() }),
  z.strictObject({ ownerType: z.literal('CUSTOMER'), customerId: uuidSchema, agentId: z.never().optional() }),
]);
/**
 * OwnerRef = ownerRefSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type OwnerRef = z.infer<typeof ownerRefSchema>;
/**
 * ownerKey = 把持有人引用转换为数据库字段组合。不属于该身份的编号明确设为 null。
 */
export function ownerKey(owner: OwnerRef): { ownerType: 'AGENT' | 'CUSTOMER'; agentId: string | null; customerId: string | null } {
  return owner.ownerType === 'AGENT'
    ? { ownerType: 'AGENT', agentId: owner.agentId, customerId: null }
    : { ownerType: 'CUSTOMER', agentId: null, customerId: owner.customerId };
}
/**
 * partyStatusSchema = 代理/客户状态规则：ACTIVE 启用、SUSPENDED 暂停、TERMINATED 终止。
 */
const partyStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'TERMINATED']);
/**
 * pricingKindSchema = 计价类别规则：WHOLESALE 批发、RETAIL 零售。
 */
const pricingKindSchema = z.enum(['WHOLESALE', 'RETAIL']);

/**
 * ==================== 02 代理、能力与首页 ====================
 * agentSchema = 代理资料返回规则，包括所属用户、上级、层级和状态；管理员列表可额外返回邮箱、余额和号码数。
 * 字段速读：id 记录编号；userId 用户编号；parentAgentId 上级代理编号；name 名称；level 代理层级；status 状态；createdAt 创建时间；email 邮箱；balanceMinor 最小货币单位余额。
 */
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
/**
 * Agent = agentSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type Agent = z.infer<typeof agentSchema>;

/**
 * subagentSchema = 下级代理展示规则。从代理资料中去掉 userId，避免不必要地返回登录账户关联。
 */
export const subagentSchema = agentSchema.omit({ userId: true });
/**
 * Subagent = subagentSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type Subagent = z.infer<typeof subagentSchema>;
/**
 * agentContextSchema = 当前代理身份与能力返回规则。capabilities 告诉页面是否能管理下级、转移持有记录，业务仍须核对权限。
 * 字段速读：agent 当前代理资料；capabilities 当前可用操作。
 */
export const agentContextSchema = z.object({
  agent: agentSchema,
  capabilities: z.object({ manageSubagents: z.boolean(), transferHoldings: z.boolean() }),
});
/**
 * AgentContext = agentContextSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AgentContext = z.infer<typeof agentContextSchema>;

/**
 * agentMetricPeriodSchema = 统计周期规则。today/7d/30d 分别是今天/7天/30天，默认 7d；它不是服务套餐期限。
 */
export const agentMetricPeriodSchema = z.enum(['today', '7d', '30d']).default('7d');
/**
 * AgentMetricPeriod = agentMetricPeriodSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AgentMetricPeriod = z.infer<typeof agentMetricPeriodSchema>;
/**
 * nullableAmountMinorSchema = 允许缺失的金额规则。null 表示没有可用数据，与金额为 0 分开表达。
 */
const nullableAmountMinorSchema = amountMinorSchema.nullable();
/**
 * nullableProfitMinorSchema = 允许缺失的利润规则。利润可以为负数，null 表示没有可用数据。
 */
const nullableProfitMinorSchema = z.number().int().nullable();
/**
 * agentDashboardSchema = 代理首页数据规则，包含余额、库存、销售、成本/利润、趋势和平台排行；缺数据允许 null。
 * 字段速读：currency 币种。
 */
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
  settlement: z.object({
    purchaseCostMinor: amountMinorSchema, downstreamSalesMinor: amountMinorSchema,
    customerSalesMinor: amountMinorSchema, soldCostMinor: amountMinorSchema,
    profitMinor: z.number().int(), inventoryValueMinor: amountMinorSchema,
  }).optional(),
  trend: z.array(z.object({ date: z.string(), salesMinor: nullableAmountMinorSchema, costMinor: nullableAmountMinorSchema, profitMinor: nullableProfitMinorSchema })),
  codeVolume: z.array(z.object({ bucket: z.string(), count: z.number().int().nonnegative(), platform: z.string().nullable() })),
  inventoryStatus: z.record(z.enum(['AVAILABLE', 'SELF_ASSIGNED', 'SUBAGENT_ASSIGNED', 'USED', 'EXPIRED', 'ERROR']), z.number().int().nonnegative()),
  serviceRanking: z.array(z.object({ service: z.string(), quantity: z.number().int().nonnegative(), salesMinor: amountMinorSchema, profitMinor: nullableProfitMinorSchema })),
  subagents: z.array(z.object({ agentId: uuidSchema, name: z.string(), salesMinor: nullableAmountMinorSchema, codeCount: z.number().int().nonnegative(), inventoryCount: z.number().int().nonnegative(), profitMinor: nullableProfitMinorSchema, lastActiveAt: timestamp.nullable() })).optional(),
});
/**
 * AgentDashboard = agentDashboardSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AgentDashboard = z.infer<typeof agentDashboardSchema>;

/**
 * ==================== 03 下级管理与客户 ====================
 * subagentsQuerySchema = 下级代理列表查询规则，复用分页并增加名称搜索和状态筛选。
 */
export const subagentsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).default(''),
  status: z.union([z.literal(''), partyStatusSchema]).default(''),
});
/**
 * SubagentsQuery = subagentsQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type SubagentsQuery = z.infer<typeof subagentsQuerySchema>;
/**
 * createSubagentInputSchema = 新建下级代理的输入规则，要求关联用户、名称和幂等编号；层级关系由后端决定。
 * 字段速读：userId 用户编号；name 名称；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
export const createSubagentInputSchema = z.strictObject({
  userId: uuidSchema, name: z.string().trim().min(1).max(120), idempotencyKey: uuidSchema,
});
/**
 * updateAgentNameInputSchema = 修改代理名称的输入规则。去首尾空格后 1～120 字符；不修改用户登录资料。
 * 字段速读：name 名称。
 */
export const updateAgentNameInputSchema = z.strictObject({ name: z.string().trim().min(1).max(120) });
/**
 * UpdateAgentNameInput = updateAgentNameInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type UpdateAgentNameInput = z.infer<typeof updateAgentNameInputSchema>;
/**
 * subagentStatusInputSchema = 修改下级状态的输入规则，只允许启用/暂停，并填写操作理由。
 * 字段速读：status 状态；reason 操作理由。
 */
export const subagentStatusInputSchema = z.strictObject({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: reasonSchema });


/**
 * customerSchema = 客户资料返回规则，包括关联用户、归属代理、名称和状态。
 * 字段速读：id 记录编号；userId 用户编号；agentId 代理编号；name 名称；status 状态；createdAt 创建时间。
 */
export const customerSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  agentId: uuidSchema.nullable(),
  name: z.string().min(1).max(120),
  status: partyStatusSchema,
  createdAt: timestamp,
});
/**
 * Customer = customerSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type Customer = z.infer<typeof customerSchema>;

/**
 * ==================== 04 余额、持有与权益 ====================
 * balanceAccountSchema = 代理或客户的余额账户规则。余额以最小货币单位整数保存，version 用于并发更新检查。
 * 字段速读：id 记录编号；ownerType 持有人类别；agentId 代理编号；customerId 客户编号；currency 币种；balanceMinor 最小货币单位余额；version 版本号；createdAt 创建时间。
 */
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
/**
 * BalanceAccount = balanceAccountSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type BalanceAccount = z.infer<typeof balanceAccountSchema>;

/**
 * numberHoldingSchema = 号码持有记录返回规则。说明谁持有、有效时间、来源、成本和是否已转移；持有记录与号码资源是两层数据。
 * 字段速读：id 记录编号；ownerType 持有人类别；agentId 代理编号；customerId 客户编号；regionId 地区编号；phoneNumber 电话号码；service 服务平台；transferable 能否转移；status 状态。
 */
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
  costMinor: amountMinorSchema.default(0),
  sourceTxOrderId: uuidSchema.nullable(),
  sourceHoldingId: uuidSchema.nullable(),
  startsAt: timestamp,
  expiresAt: timestamp.nullable(),
  transferredAt: timestamp.nullable(),
  acquiredAt: timestamp,
  createdAt: timestamp,
});
/**
 * NumberHolding = numberHoldingSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type NumberHolding = z.infer<typeof numberHoldingSchema>;

/**
 * holdingTransferSchema = 下级取得号码的转移记录规则，currentlyHeld 区分当前仍持有还是已继续转出。
 * 字段速读：id 记录编号；phoneNumber 电话号码；regionId 地区编号；startsAt 开始时间；expiresAt 到期时间；transferredAt 转移时间。
 */
export const holdingTransferSchema = z.object({
  id: uuidSchema, phoneNumber: z.string(), regionId: z.string(),
  startsAt: timestamp, expiresAt: timestamp.nullable(), transferredAt: timestamp,
  currentlyHeld: z.boolean(),
});
/**
 * HoldingTransfer = holdingTransferSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type HoldingTransfer = z.infer<typeof holdingTransferSchema>;
/**
 * transferableHoldingSchema = 可以转移的持有资料规则，在普通持有记录上要求明确的服务平台。
 */
export const transferableHoldingSchema = numberHoldingSchema.extend({ service: serviceSchema });
/**
 * TransferableHolding = transferableHoldingSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type TransferableHolding = z.infer<typeof transferableHoldingSchema>;

/**
 * serviceEntitlementSchema = 服务使用权益规则。把某条持有记录与具体平台、使用时间及来源交易关联。
 * 字段速读：id 记录编号；holdingId 持有记录编号；service 服务平台；startsAt 开始时间；expiresAt 到期时间；status 状态；sourceTxOrderId 来源交易编号；createdAt 创建时间。
 */
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
/**
 * ServiceEntitlement = serviceEntitlementSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type ServiceEntitlement = z.infer<typeof serviceEntitlementSchema>;

/**
 * ==================== 05 价格、交易与账本 ====================
 * priceRuleSchema = 价格规则返回结构。区分卖方、买方、批发/零售、国家、平台、套餐和币种。
 * 字段速读：id 记录编号；pricingKind 批发或零售计价类别；sellerType 卖方类别；agentId 代理编号；buyerAgentId 买方代理编号；sellerAgentId 卖方代理编号；regionId 地区编号；service 服务平台；plan 套餐代号。
 */
export const priceRuleSchema = z.object({
  id: uuidSchema,
  pricingKind: pricingKindSchema,
  sellerType: z.enum(['PLATFORM', 'AGENT']).default('PLATFORM'),
  agentId: uuidSchema.nullable(),
  buyerAgentId: uuidSchema.nullable(),
  sellerAgentId: uuidSchema.nullable().default(null),
  regionId: z.string().nullable(),
  service: z.string().min(1),
  plan: z.string().min(1),
  currency: currencySchema,
  unitAmountMinor: amountMinorSchema,
  priority: z.number().int().nonnegative(),
  isActive: z.boolean(),
  createdAt: timestamp,
});
/**
 * PriceRule = priceRuleSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type PriceRule = z.infer<typeof priceRuleSchema>;

/**
 * txOrderSchema = 代理交易返回结构，包含买卖双方、接收方、金额、成本、计费天数与交易状态；它不是商城积分订单。
 * 字段速读：id 记录编号；orderNumber 订单编号；kind 类别；buyerType 买方类别；buyerAgentId 买方代理编号；buyerCustomerId 买方客户编号；sellerType 卖方类别；sellerAgentId 卖方代理编号；recipientType 接收方类别。
 */
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
  unitAmountMinor: amountMinorSchema.nullable().default(null),
  billedDays: z.number().int().positive().nullable().default(null),
  priceRuleId: uuidSchema.nullable().default(null),
  bookAmountMinor: amountMinorSchema.default(0),
  costMinor: amountMinorSchema.nullable().default(null),
  quantity: z.number().int().positive().default(1),
  points: z.number().int().positive().nullable(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  sourceOrderId: uuidSchema.nullable(),
  createdAt: timestamp,
  completedAt: timestamp.nullable(),
});
/**
 * TxOrder = txOrderSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type TxOrder = z.infer<typeof txOrderSchema>;

/**
 * balanceLedgerSchema = 代理货币账本规则。delta 是金额变化，accountId 是余额账户，txOrderId 关联代理交易。
 * 字段速读：id 记录编号；delta 本次金额或积分变化；balanceAfter 变化后的余额；description 账目说明；txOrderId 关联代理交易编号；createdAt 创建时间。
 */
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
/**
 * BalanceLedgerEntry = balanceLedgerSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type BalanceLedgerEntry = z.infer<typeof balanceLedgerSchema>;

/**
 * ==================== 06 身份、价格和金额写操作输入 ====================
 * createAgentInputSchema = 创建代理输入规则。前端可传关联用户、上级、名称、层级；业务层仍验证允许的上下级关系。
 * 字段速读：userId 用户编号；parentAgentId 上级代理编号；name 名称；level 代理层级；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
export const createAgentInputSchema = z.strictObject({
  userId: uuidSchema,
  parentAgentId: uuidSchema.nullable().default(null),
  name: z.string().trim().min(1).max(120),
  level: z.number().int().min(1).max(2).default(1),
  idempotencyKey: uuidSchema.optional(),
});
/**
 * CreateAgentInput = createAgentInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type CreateAgentInput = z.infer<typeof createAgentInputSchema>;
/**
 * createCustomerInputSchema = 创建客户输入规则。客户关联登录用户，可指定所属代理；最终归属由业务权限检查。
 * 字段速读：userId 用户编号；agentId 代理编号；name 名称。
 */
export const createCustomerInputSchema = z.strictObject({
  userId: uuidSchema,
  agentId: uuidSchema.nullable().default(null),
  name: z.string().trim().min(1).max(120),
});
/**
 * CreateCustomerInput = createCustomerInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type CreateCustomerInput = z.infer<typeof createCustomerInputSchema>;
/**
 * createTxOrderInputSchema = 创建代理交易的通用输入规则。声明买方、交易类型、计价类别、金额及幂等编号；不表示任意用户都有权限入账。
 * 字段速读：kind 类别；buyerType 买方类别；buyerAgentId 买方代理编号；buyerCustomerId 买方客户编号；pricingKind 批发或零售计价类别；currency 币种；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
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

/**
 * CreateTxOrderInput = createTxOrderInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type CreateTxOrderInput = z.infer<typeof createTxOrderInputSchema>;

/**
 * upsertPriceRuleInputSchema = 保存价格规则输入。当前 plan 被统一为 P30D，currency 固定 USD；unitAmountMinor 是每 30 天计价基准。
 * 字段速读：pricingKind 批发或零售计价类别；sellerType 卖方类别；sellerAgentId 卖方代理编号；agentId 代理编号；buyerAgentId 买方代理编号；regionId 地区编号；service 服务平台；plan 套餐代号；currency 币种。
 */
export const upsertPriceRuleInputSchema = z.strictObject({
  pricingKind: pricingKindSchema,
  sellerType: z.enum(['PLATFORM', 'AGENT']).optional(),
  sellerAgentId: uuidSchema.nullable().optional(),
  agentId: uuidSchema.nullable().default(null),
  buyerAgentId: uuidSchema.nullable().default(null),
  regionId: z.string().nullable().default(null),
  service: z.string().trim().min(1).max(64),
  plan: z.string().default('P30D').transform(() => 'P30D'),
  currency: z.literal('USD').default('USD'),
  unitAmountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  priority: z.number().int().nonnegative().max(100000).default(0),
  isActive: z.boolean().default(true),
});
/**
 * UpsertPriceRuleInput = upsertPriceRuleInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type UpsertPriceRuleInput = z.infer<typeof upsertPriceRuleInputSchema>;

/**
 * transferBalanceInputSchema = 余额转账输入规则。fromOwner/toOwner 区分转出与转入账户，amountMinor 为正整数，幂等编号防重复。
 * 字段速读：currency 币种；amountMinor 最小货币单位金额；description 账目说明；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
export const transferBalanceInputSchema = z.strictObject({
  fromOwner: ownerRefSchema,
  toOwner: ownerRefSchema,
  currency: currencySchema,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  description: z.string().trim().min(1).max(200).optional(),
  idempotencyKey: uuidSchema,
});
/**
 * TransferBalanceInput = transferBalanceInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type TransferBalanceInput = z.infer<typeof transferBalanceInputSchema>;

/**
 * createHoldingInputSchema = 手动创建持有记录输入规则。包含持有人、号码、平台、起止时间与幂等编号；是否允许由后端判断。
 * 字段速读：regionId 地区编号；phoneNumber 电话号码；service 服务平台；startsAt 开始时间；expiresAt 到期时间；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
export const createHoldingInputSchema = ownerRefSchema.and(z.strictObject({
  regionId: z.string().trim().min(1).max(32),
  phoneNumber: z.string().trim().min(5).max(32),
  service: z.string().trim().min(1).max(64),
  startsAt: timestamp,
  expiresAt: timestamp.nullable().default(null),
  idempotencyKey: uuidSchema,
}));
/**
 * CreateHoldingInput = createHoldingInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type CreateHoldingInput = z.infer<typeof createHoldingInputSchema>;

/**
 * adjustBalanceInputSchema = 管理员余额调整输入规则。CREDIT 加款、DEBIT 扣款，必须有理由与幂等编号。
 * 字段速读：currency 币种；amountMinor 最小货币单位金额；reason 操作理由；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
export const adjustBalanceInputSchema = ownerRefSchema.and(z.strictObject({
  currency: currencySchema,
  direction: z.enum(['CREDIT', 'DEBIT']),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(3).max(200),
  idempotencyKey: uuidSchema,
}));
/**
 * AdjustBalanceInput = adjustBalanceInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AdjustBalanceInput = z.infer<typeof adjustBalanceInputSchema>;

/**
 * ==================== 07 列表与账本查询 ====================
 * agentInventoryQuerySchema = 代理持有列表查询规则，可按代理、状态、搜索词、国家和平台筛选；可见范围由后端另加条件。
 */
export const agentInventoryQuerySchema = paginationQuerySchema.extend({
  agentId: uuidSchema.optional(),
  status: z.union([z.literal(''), z.enum(['ACTIVE', 'SUSPENDED', 'RETIRED'])]).default(''),
  search: z.string().max(64).default(''),
  region: z.union([z.literal(''), regionIdSchema]).default(''),
  service: z.union([z.literal(''), serviceSchema]).default(''),
});
/**
 * AgentInventoryQuery = agentInventoryQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AgentInventoryQuery = z.infer<typeof agentInventoryQuerySchema>;

/**
 * updateCustomerInputSchema = 修改客户资料输入规则。名称、启用/暂停状态和理由一起提交。
 * 字段速读：name 名称；status 状态；reason 操作理由。
 */
export const updateCustomerInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: reasonSchema,
});
/**
 * UpdateCustomerInput = updateCustomerInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type UpdateCustomerInput = z.infer<typeof updateCustomerInputSchema>;

/**
 * ledgerQuerySchema = 代理账本分页查询规则。currency 默认 USD，查询币种不是自动换汇。
 */
export const ledgerQuerySchema = paginationQuerySchema.extend({ currency: currencySchema.default('USD') });
/**
 * LedgerQuery = ledgerQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

/**
 * agentTransactionsQuerySchema = 代理交易列表查询规则，支持交易类型、状态和搜索词。
 */
export const agentTransactionsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(64).default(''),
  kind: z.union([z.literal(''), z.enum(['PURCHASE', 'RENEW', 'TRANSFER', 'ADJUSTMENT'])]).default(''),
  status: z.union([z.literal(''), z.enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'])]).default(''),
});
/**
 * AgentTransactionsQuery = agentTransactionsQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AgentTransactionsQuery = z.infer<typeof agentTransactionsQuerySchema>;

/**
 * ==================== 08 统一库存与导入格式 ====================
 * agentStockQuerySchema = 统一号码库存查询规则。可按可用/已分配/已释放、号码搜索、平台和地区筛选。
 */
export const agentStockQuerySchema = paginationQuerySchema.extend({
  status: z.union([z.literal(''), z.enum(['AVAILABLE', 'ALLOCATED', 'RELEASED'])]).default(''),
  search: z.string().trim().max(64).default(''),
  platform: z.union([z.literal(''), serviceSchema]).default(''),
  region: z.union([z.literal(''), regionIdSchema]).default(''),
});
/**
 * agentStockCountsSchema = 库存各状态的数量汇总规则。与当前页 data 列表分开返回。
 */
export const agentStockCountsSchema = z.object({ AVAILABLE: z.number().int(), ALLOCATED: z.number().int(), RELEASED: z.number().int() });
/**
 * AgentStockQuery = agentStockQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AgentStockQuery = z.infer<typeof agentStockQuerySchema>;

/**
 * stockResourceStatusSchema = 底层号码资源状态规则：本地、在线、离线或错误；与是否被领用是不同维度。
 */
const stockResourceStatusSchema = z.enum(['LOCAL', 'ONLINE', 'OFFLINE', 'ERROR']);
/**
 * agentNumberStockSchema = 统一库存返回规则，包含来源、平台、外部编号、资源状态、领用状态和资源到期时间。
 * 字段速读：id 记录编号；provider 供应商来源；phoneNumber 电话号码；regionId 地区编号；status 状态；holdingId 持有记录编号。
 */
export const agentNumberStockSchema = z.object({
  id: uuidSchema, inventoryId: uuidSchema,
  provider: z.enum(['pingcode', 'pingcode-mock']),
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
/**
 * AgentNumberStock = agentNumberStockSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AgentNumberStock = z.infer<typeof agentNumberStockSchema>;

/**
 * agentNumberImportRowSchema = 单条本地库存导入规则。当前 provider 仅允许 pingcode-mock，导入资料不代表真实上游采购。
 * 字段速读：provider 供应商来源；phoneNumber 电话号码；regionId 地区编号。
 */
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
/**
 * AgentNumberImportRow = agentNumberImportRowSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AgentNumberImportRow = z.infer<typeof agentNumberImportRowSchema>;
/**
 * agentNumberImportInputSchema = 库存导入批次规则，一次 1～500 条，必须有幂等编号与理由。
 * 字段速读：idempotencyKey 防止同一次操作重复执行的请求编号；reason 操作理由。
 */
export const agentNumberImportInputSchema = z.strictObject({
  rows: z.array(agentNumberImportRowSchema).min(1).max(500),
  idempotencyKey: uuidSchema,
  reason: reasonSchema,
});
/**
 * AgentNumberImportInput = agentNumberImportInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AgentNumberImportInput = z.infer<typeof agentNumberImportInputSchema>;

/**
 * ==================== 09 单个或批量领用及流转 ====================
 * holdingWindowSchema = 号码持有时间窗口规则：开始和到期时间，另可指定服务平台。
 * 字段速读：startsAt 开始时间；expiresAt 到期时间；service 服务平台。
 */
const holdingWindowSchema = z.strictObject({
  startsAt: timestamp,
  expiresAt: timestamp,
  service: serviceSchema.optional(),
});
/**
 * claimAgentNumberInputSchema = 领用单个库存号码的输入规则。提交库存编号、时间窗口、报价标识和幂等编号。
 * 字段速读：stockId 库存编号；agentId 代理编号；startsAt 开始时间；expiresAt 到期时间；service 服务平台；quoteFingerprint 报价校验标识；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
export const claimAgentNumberInputSchema = z.strictObject({
  stockId: uuidSchema,
  agentId: uuidSchema.optional(),
  startsAt: timestamp,
  expiresAt: timestamp,
  service: serviceSchema.optional(),
  quoteFingerprint: z.string().optional(),
  idempotencyKey: uuidSchema,
});
/**
 * ClaimAgentNumberInput = claimAgentNumberInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type ClaimAgentNumberInput = z.infer<typeof claimAgentNumberInputSchema>;
/**
 * claimAgentNumbersInputSchema = 批量领用库存输入规则，一次 1～100 个且编号不能重复；区别于最多 10000 条的持有转移。
 * 字段速读：stockIds 库存编号列表；agentId 代理编号；startsAt 开始时间；expiresAt 到期时间；service 服务平台；quoteFingerprint 报价校验标识；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
export const claimAgentNumbersInputSchema = z.strictObject({
  stockIds: z.array(uuidSchema).min(1).max(100).refine(ids => new Set(ids).size === ids.length, 'stockIds must be unique'),
  agentId: uuidSchema.optional(),
  startsAt: timestamp,
  expiresAt: timestamp,
  service: serviceSchema.optional(),
  quoteFingerprint: z.string().optional(),
  idempotencyKey: uuidSchema,
});
/**
 * ClaimAgentNumbersInput = claimAgentNumbersInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type ClaimAgentNumbersInput = z.infer<typeof claimAgentNumbersInputSchema>;
/**
 * releaseHoldingInputSchema = 释放持有记录的输入规则。理由和幂等编号用于审计及防止重复操作。
 * 字段速读：reason 操作理由；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
export const releaseHoldingInputSchema = z.strictObject({
  reason: reasonSchema,
  idempotencyKey: uuidSchema,
});
/**
 * ReleaseHoldingInput = releaseHoldingInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type ReleaseHoldingInput = z.infer<typeof releaseHoldingInputSchema>;
/**
 * resellHoldingInputSchema = 转售给下级代理的输入规则。指定来源持有、目标代理、期限及报价标识，后端检查是否属于直属下级。
 * 字段速读：holdingId 持有记录编号；startsAt 开始时间；expiresAt 到期时间；quoteFingerprint 报价校验标识；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
export const resellHoldingInputSchema = z.strictObject({
  holdingId: uuidSchema,
  toAgentId: uuidSchema,
  startsAt: timestamp,
  expiresAt: timestamp,
  quoteFingerprint: z.string().optional(),
  idempotencyKey: uuidSchema,
});
/**
 * ResellHoldingInput = resellHoldingInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type ResellHoldingInput = z.infer<typeof resellHoldingInputSchema>;
/**
 * assignHoldingInputSchema = 分配号码给客户的输入规则。指定持有记录、客户、时间和可选记账金额；不等同于供应商续期。
 * 字段速读：holdingId 持有记录编号；customerId 客户编号；startsAt 开始时间；expiresAt 到期时间；bookAmountMinor 记账金额；quoteFingerprint 报价校验标识；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
export const assignHoldingInputSchema = z.strictObject({
  holdingId: uuidSchema,
  customerId: uuidSchema,
  startsAt: timestamp,
  expiresAt: timestamp,
  bookAmountMinor: amountMinorSchema.max(Number.MAX_SAFE_INTEGER).optional(),
  quoteFingerprint: z.string().optional(),
  idempotencyKey: uuidSchema,
});
/**
 * AssignHoldingInput = assignHoldingInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AssignHoldingInput = z.infer<typeof assignHoldingInputSchema>;

// FILTER selects every eligible holding across pages; the preview fingerprint freezes that set.
/**
 * ==================== 10 跨页批量选择、预览与执行 ====================
 * holdingBatchSelectionSchema = 批量选择规则。IDS 明确选择最多 10000 个唯一编号；FILTER 按筛选条件选择跨页全部符合记录。
 * 字段速读：mode 选择模式；holdingIds 持有记录编号列表。
 */
export const holdingBatchSelectionSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('IDS'), holdingIds: z.array(uuidSchema).min(1).max(10000).refine(ids => new Set(ids).size === ids.length, 'holdingIds must be unique') }),
  z.strictObject({ mode: z.literal('FILTER'), search: z.string().max(64).default(''),
    status: z.union([z.literal(''), z.enum(['ACTIVE', 'SUSPENDED', 'RETIRED'])]).default(''),
    region: z.union([z.literal(''), regionIdSchema]).default(''), service: z.union([z.literal(''), serviceSchema]).default('') }),
]);
/**
 * HoldingBatchSelection = holdingBatchSelectionSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type HoldingBatchSelection = z.infer<typeof holdingBatchSelectionSchema>;
/**
 * holdingBatchPreviewInputSchema = 批量预览输入规则。选哪些记录、交给谁、期限和记账金额；此阶段不执行转移。
 * 字段速读：selection 批量选择条件；recipient 接收方；expiresAt 到期时间；bookAmountMinor 记账金额。
 */
export const holdingBatchPreviewInputSchema = z.strictObject({
  selection: holdingBatchSelectionSchema, recipient: ownerRefSchema, expiresAt: timestamp.nullable().default(null),
  bookAmountMinor: amountMinorSchema.max(Number.MAX_SAFE_INTEGER).optional(),
});
/**
 * HoldingBatchPreviewInput = holdingBatchPreviewInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type HoldingBatchPreviewInput = z.infer<typeof holdingBatchPreviewInputSchema>;
/**
 * holdingBatchInputSchema = 批量执行输入规则。在预览输入上增加内容校验标识和幂等编号，后端重算确认未改变。
 */
export const holdingBatchInputSchema = holdingBatchPreviewInputSchema.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}:[a-f0-9]{64}$/), idempotencyKey: uuidSchema,
});
/**
 * HoldingBatchInput = holdingBatchInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type HoldingBatchInput = z.infer<typeof holdingBatchInputSchema>;
/**
 * ==================== 11 结算报价与明细 ====================
 * settlementQuoteSchema = 结算报价返回规则。包含应付、记账、成本、利润、余额、是否足够和报价校验标识。
 * 字段速读：fingerprint 预览或报价内容的校验标识；currency 币种；amountMinor 最小货币单位金额；bookAmountMinor 记账金额；costMinor 成本金额；profitMinor 利润金额；unitAmountMinor 单价金额。
 */
export const settlementQuoteSchema = z.object({
  fingerprint: z.string(), currency: z.literal('USD'), amountMinor: amountMinorSchema,
  bookAmountMinor: amountMinorSchema, costMinor: amountMinorSchema, profitMinor: z.number().int(),
  buyerBalanceMinor: amountMinorSchema, sufficient: z.boolean(),
  unitAmountMinor: amountMinorSchema.nullable(), billedDays: z.number().int().positive().nullable(),
  count: z.number().int().positive(), missingReference: z.boolean(),
});
/**
 * SettlementQuote = settlementQuoteSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type SettlementQuote = z.infer<typeof settlementQuoteSchema>;
/**
 * settlementQuoteInputSchema = 结算预览输入规则，按 CLAIM 领用、RESELL 转售、ASSIGN 客户分配区分操作。
 * 字段速读：stockIds 库存编号列表；holdingId 持有记录编号；agentId 代理编号；customerId 客户编号；startsAt 开始时间；expiresAt 到期时间；bookAmountMinor 记账金额。
 */
export const settlementQuoteInputSchema = z.strictObject({
  operation: z.enum(['CLAIM', 'RESELL', 'ASSIGN']),
  stockIds: z.array(uuidSchema).min(1).max(100).optional(), holdingId: uuidSchema.optional(),
  agentId: uuidSchema.optional(), customerId: uuidSchema.optional(),
  startsAt: timestamp, expiresAt: timestamp,
  bookAmountMinor: amountMinorSchema.max(Number.MAX_SAFE_INTEGER).optional(),
});
/**
 * SettlementQuoteInput = settlementQuoteInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type SettlementQuoteInput = z.infer<typeof settlementQuoteInputSchema>;
/**
 * settlementOrderItemSchema = 结算订单单条明细返回规则，记录号码、服务时间、单价、计费天数和实际金额。
 * 字段速读：phoneNumber 电话号码；service 服务平台；regionId 地区编号；startsAt 开始时间；expiresAt 到期时间；unitAmountMinor 单价金额；amountMinor 最小货币单位金额；bookAmountMinor 记账金额。
 */
export const settlementOrderItemSchema = z.object({
  phoneNumber: z.string(), service: z.string(), regionId: z.string(),
  startsAt: timestamp, expiresAt: timestamp, unitAmountMinor: amountMinorSchema.nullable(),
  billedDays: z.number().int().positive(), amountMinor: amountMinorSchema, bookAmountMinor: amountMinorSchema,
});
/**
 * platformSettlementSchema = 平台结算汇总返回规则，当前币种 USD，包含总金额、数量和交易单数。
 * 字段速读：currency 币种；amountMinor 最小货币单位金额；quantity 数量。
 */
export const platformSettlementSchema = z.object({ currency: z.literal('USD'), amountMinor: amountMinorSchema, quantity: z.number().int().nonnegative(), orders: z.number().int().nonnegative() });
/**
 * settlementOrderDetailSchema = 结算订单详情规则。订单头、逐项明细和分页分别返回。
 * 字段速读：pagination 分页信息。
 */
export const settlementOrderDetailSchema = z.object({
  order: txOrderSchema, items: z.array(settlementOrderItemSchema), pagination: z.object({ page: z.number(), pageSize: z.number(), totalItems: z.number(), totalPages: z.number() }),
});
/**
 * holdingBatchPreviewSchema = 批量预览结果规则。最多 10000 条，返回样例、期限范围、地区/平台分布与结算报价。
 * 字段速读：fingerprint 预览或报价内容的校验标识。
 */
export const holdingBatchPreviewSchema = z.object({
  settlement: settlementQuoteSchema,
  fingerprint: z.string(), count: z.number().int().positive().max(10000),
  sample: z.array(z.string()), earliestExpiresAt: timestamp, latestStartsAt: timestamp,
  regions: z.array(z.object({ value: z.string(), count: z.number().int().positive() })),
  services: z.array(z.object({ value: z.string(), count: z.number().int().positive() })),
});
/**
 * HoldingBatchPreview = holdingBatchPreviewSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type HoldingBatchPreview = z.infer<typeof holdingBatchPreviewSchema>;
/**
 * holdingBatchResultSchema = 批量执行结果规则。返回交易编号、转移数量和是否为重复请求的结果。
 */
export const holdingBatchResultSchema = z.object({
  orderId: uuidSchema, count: z.number().int().positive(), replayed: z.boolean(),
});
/**
 * HoldingBatchResult = holdingBatchResultSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type HoldingBatchResult = z.infer<typeof holdingBatchResultSchema>;
/**
 * ==================== 12 代理状态修改 ====================
 * agentStatusInputSchema = 代理状态修改输入规则。可用状态来自 partyStatusSchema，必须填写理由；具体角色能改哪些状态由后端约束。
 * 字段速读：status 状态；reason 操作理由。
 */
export const agentStatusInputSchema = z.strictObject({ status: partyStatusSchema, reason: reasonSchema });
/**
 * AgentStatusInput = agentStatusInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AgentStatusInput = z.infer<typeof agentStatusInputSchema>;
