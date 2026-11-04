/**
 * recharge.ts 中文分区导读副本：充值金额与规则契约
 * 原文件：packages/contracts/src/recharge.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。多数规则使用 Zod 描述输入或返回格式，类型声明供编辑器检查。
 * 【整体用途】检查充值范围和兑换规则，精确转换金额与积分，并描述充值记录和配置。
 * 【为什么这样组织】金额用最小货币单位整数和 BigInt 计算，避免小数计算误差；校验范围、预设值和兑换比例必须彼此一致。
 * 【调用链】页面金额输入 → parseRechargeAmount → calculateRechargePoints → 后端充值业务。
 * 【修改提示】改充值范围/兑换比例优先用后台充值设置；fractionDigits 决定最小货币单位的缩放方式。当前 paymentStatus 固定 not_connected，不会因此接通支付。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { z } from 'zod';

/**
 * ==================== 01 金额、积分与充值规则 ====================
 * minorAmount = 正整数金额规则。金额用最小货币单位保存，并限制在安全整数范围内。
 */
const minorAmount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
/**
 * pointAmount = 正整数积分规则。上限与当前数据库积分整数范围对应。
 */
const pointAmount = z.number().int().positive().max(2147483647);
/**
 * rechargeRulesSchema = 充值规则检查。币种、小数位、上下限、快捷金额和兑换比例要相互一致；预设金额必须能兑换为整数积分。
 * 字段速读：currency 币种；fractionDigits 金额小数位数；minimumMinor 最小充值金额；maximumMinor 最大充值金额；presetsMinor 预设充值金额；exchangeAmountMinor 兑换基准金额；exchangePoints 对应积分数。
 */
export const rechargeRulesSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/).refine(value => Intl.supportedValuesOf('currency').includes(value), 'Use a supported ISO 4217 currency'),
  fractionDigits: z.number().int().min(0).max(6),
  minimumMinor: minorAmount,
  maximumMinor: minorAmount,
  presetsMinor: z.array(minorAmount).max(12),
  exchangeAmountMinor: minorAmount.nullable().default(null),
  exchangePoints: pointAmount.nullable().default(null),
}).superRefine((rules, context) => {
  if (rules.minimumMinor > rules.maximumMinor || rules.presetsMinor.some(amount => amount < rules.minimumMinor || amount > rules.maximumMinor)
    || new Set(rules.presetsMinor).size !== rules.presetsMinor.length) {
    context.addIssue({ code: 'custom', message: 'Recharge range and presets must be consistent' });
  }
  if ((rules.exchangeAmountMinor === null) !== (rules.exchangePoints === null)) {
    context.addIssue({ code: 'custom', path: ['exchangePoints'], message: 'Supply both exchange amount and points' });
  }
  if (rules.exchangeAmountMinor !== null && rules.exchangePoints !== null
    && Number.isSafeInteger(rules.exchangeAmountMinor) && rules.exchangeAmountMinor > 0
    && Number.isSafeInteger(rules.exchangePoints) && rules.exchangePoints > 0
    && Number.isSafeInteger(rules.maximumMinor) && rules.maximumMinor > 0
    && rules.presetsMinor.every(amount => Number.isSafeInteger(amount) && amount > 0)) {
    const divisor = BigInt(rules.exchangeAmountMinor);
    const multiplier = BigInt(rules.exchangePoints);
    if (BigInt(rules.maximumMinor) * multiplier > 2147483647n * divisor) {
      context.addIssue({ code: 'custom', path: ['maximumMinor'], message: 'Maximum amount exceeds the supported points range' });
    }
    if (rules.presetsMinor.some(amount => BigInt(amount) * multiplier % divisor !== 0n)) {
      context.addIssue({ code: 'custom', path: ['presetsMinor'], message: 'Every preset must convert to whole points' });
    }
  }
});
/**
 * RechargeRules = rechargeRulesSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type RechargeRules = z.infer<typeof rechargeRulesSchema>;
/**
 * AmountResult = 金额解析结果，成功带 amountMinor，失败带错误类别。这里只描述结构，执行操作需看后面的函数。
 */
export type AmountResult = { amountMinor: number; error: null } | { amountMinor: null; error: 'empty' | 'format' | 'configuration' | 'precision' | 'range' };
/**
 * ==================== 02 精确解析、兑换与展示 ====================
 * parseRechargeAmount = 解析充值金额文字。按 fractionDigits 转换为最小货币单位整数，区分空值、格式、配置、精度和范围错误。
 */
export function parseRechargeAmount(value: string, rules: RechargeRules | null): AmountResult {
  if (!value.trim()) return { amountMinor: null, error: 'empty' };
  if (value.length > 32 || !/^\d+(?:\.\d+)?$/.test(value) || !/[1-9]/.test(value)) return { amountMinor: null, error: 'format' };
  if (!rules) return { amountMinor: null, error: 'configuration' };
  const [integer, fraction = ''] = value.split('.');
  if (fraction.length > rules.fractionDigits) return { amountMinor: null, error: 'precision' };
  const scaled = BigInt(integer!) * 10n ** BigInt(rules.fractionDigits) + BigInt(fraction.padEnd(rules.fractionDigits, '0') || '0');
  if (scaled < BigInt(rules.minimumMinor) || scaled > BigInt(rules.maximumMinor)) return { amountMinor: null, error: 'range' };
  return { amountMinor: Number(scaled), error: null };
}
/**
 * RechargePointsResult = 积分换算结果，成功带 points，失败带错误类别。这里只描述结构，执行操作需看后面的函数。
 */
export type RechargePointsResult = { points: number; error: null } | { points: null; error: 'configuration' | 'precision' | 'range' };
/**
 * calculateRechargePoints = 将金额换算成积分。使用整数与 BigInt 计算，不能整除或超出积分范围时返回错误，不直接四舍五入。
 */
export function calculateRechargePoints(amountMinor: number, rules: RechargeRules | null): RechargePointsResult {
  if (!rules?.exchangeAmountMinor || !rules.exchangePoints) return { points: null, error: 'configuration' };
  if (!Number.isSafeInteger(amountMinor) || amountMinor < rules.minimumMinor || amountMinor > rules.maximumMinor) return { points: null, error: 'range' };
  const numerator = BigInt(amountMinor) * BigInt(rules.exchangePoints);
  const divisor = BigInt(rules.exchangeAmountMinor);
  if (numerator % divisor !== 0n) return { points: null, error: 'precision' };
  const points = numerator / divisor;
  if (points < 1n || points > 2147483647n) return { points: null, error: 'range' };
  return { points: Number(points), error: null };
}
/**
 * rechargeAmountInput = 把最小货币单位金额变成输入框文字。例如 fractionDigits=2 时，1234 对应 12.34。
 */
export function rechargeAmountInput(minor: number, fractionDigits: number) {
  const value = BigInt(minor).toString().padStart(fractionDigits + 1, '0');
  return fractionDigits ? `${value.slice(0, -fractionDigits)}.${value.slice(-fractionDigits)}` : value;
}
/**
 * formatRechargeAmount = 按币种和地区格式化金额显示。整数部分和小数部分分别处理，避免把大额整数先转成不精确小数。
 */
export function formatRechargeAmount(minor: number, rules: Pick<RechargeRules, 'currency' | 'fractionDigits'>, locale: string) {
  const scale = 10n ** BigInt(rules.fractionDigits);
  const value = BigInt(minor);
  const fraction = rules.fractionDigits ? new Intl.NumberFormat(locale, { useGrouping: false,
    minimumIntegerDigits: rules.fractionDigits, maximumFractionDigits: 0 }).format(value % scale) : '';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: rules.currency,
    minimumFractionDigits: rules.fractionDigits, maximumFractionDigits: rules.fractionDigits })
    .formatToParts(value / scale).map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

/**
 * ==================== 03 充值订单与列表 ====================
 * rechargeStatusSchema = 充值状态规则：待支付、成功、失败、过期或取消。
 */
export const rechargeStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED']);
/**
 * createRechargeOrderInputSchema = 创建充值订单输入规则。包含金额、可选支付方式和幂等编号；不是付款成功凭据。
 * 字段速读：amountMinor 最小货币单位金额；paymentMethod 支付方式；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
export const createRechargeOrderInputSchema = z.strictObject({
  amountMinor: minorAmount, paymentMethod: z.string().trim().min(1).max(40).optional(), idempotencyKey: z.uuid(),
});
/**
 * rechargeRecordSchema = 充值记录返回规则。保存订单金额、积分和各阶段时间，创建时间、付款时间、入账时间分别表达。
 * 字段速读：id 记录编号；orderNumber 订单编号；currency 币种；fractionDigits 金额小数位数；amountMinor 最小货币单位金额；points 积分数；status 状态；paymentMethod 支付方式；createdAt 创建时间。
 */
export const rechargeRecordSchema = z.object({
  id: z.uuid(), orderNumber: z.string(), currency: z.string(), fractionDigits: z.number().int(),
  amountMinor: minorAmount, points: pointAmount, status: rechargeStatusSchema,
  paymentMethod: z.string().nullable(), createdAt: z.string(), paidAt: z.string().nullable(), creditedAt: z.string().nullable(),
});
/**
 * adminRechargeRecordSchema = 管理员看到的充值记录规则，在普通记录上增加用户身份和供应商交易编号。
 */
export const adminRechargeRecordSchema = rechargeRecordSchema.extend({
  userId: z.uuid(), ownerName: z.string(), email: z.string(), providerTransactionId: z.string().nullable(),
});
/**
 * rechargeQuerySchema = 充值列表查询规则。默认每页 20 条，可按状态和搜索词筛选。
 * 字段速读：page 页码；pageSize 每页条数；status 状态；search 搜索词。
 */
export const rechargeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.union([z.literal(''), rechargeStatusSchema]).default(''),
  search: z.string().trim().max(200).default(''),
});
/**
 * adminRechargeQuerySchema = 后台充值查询规则，在普通查询基础上增加指定用户编号。
 */
export const adminRechargeQuerySchema = rechargeQuerySchema.extend({ userId: z.uuid().optional() });
/**
 * ==================== 04 设置与页面概览 ====================
 * rechargeSettingsSchema = 充值配置返回规则。包含规则、版本、来源和修改人；rules 为 null 表示未配置。
 * 字段速读：rules 充值规则；version 版本号；source 数据来源；updatedAt 更新时间。
 */
export const rechargeSettingsSchema = z.object({
  rules: rechargeRulesSchema.nullable(), version: z.number().int().nonnegative(),
  source: z.enum(['database', 'environment', 'unconfigured']), updatedAt: z.string().nullable(), updatedBy: z.string().nullable(),
});
/**
 * rechargeSettingsInputSchema = 保存充值配置的输入规则。expectedVersion 防止覆盖别人刚改的配置，reason 用于审计。
 * 字段速读：rules 充值规则；expectedVersion 预期配置版本；reason 操作理由。
 */
export const rechargeSettingsInputSchema = z.strictObject({
  rules: rechargeRulesSchema.refine(rules => rules.exchangeAmountMinor !== null && rules.exchangePoints !== null,
    'An exchange rate is required').nullable(),
  expectedVersion: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(500),
});
/**
 * rechargeOverviewSchema = 充值页概览规则。当前 paymentStatus 固定 not_connected、支付方式为空；有兑换规则也不等于支付已接通。
 * 字段速读：rules 充值规则；paymentStatus 支付接入状态；paymentMethods 支付方式列表。
 */
export const rechargeOverviewSchema = z.object({
  pointsBalance: z.number().int().nonnegative(), rules: rechargeRulesSchema.nullable(),
  paymentStatus: z.literal('not_connected'), paymentMethods: z.array(z.never()),
});
/**
 * ==================== 05 导出数据类型 ====================
 * RechargeOverview = rechargeOverviewSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type RechargeOverview = z.infer<typeof rechargeOverviewSchema>;
/**
 * RechargeRecord = rechargeRecordSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type RechargeRecord = z.infer<typeof rechargeRecordSchema>;
/**
 * RechargeStatus = rechargeStatusSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type RechargeStatus = z.infer<typeof rechargeStatusSchema>;
/**
 * CreateRechargeOrderInput = createRechargeOrderInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type CreateRechargeOrderInput = z.infer<typeof createRechargeOrderInputSchema>;
/**
 * RechargeQuery = rechargeQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type RechargeQuery = z.infer<typeof rechargeQuerySchema>;
/**
 * AdminRechargeQuery = adminRechargeQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AdminRechargeQuery = z.infer<typeof adminRechargeQuerySchema>;
/**
 * RechargeSettings = rechargeSettingsSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type RechargeSettings = z.infer<typeof rechargeSettingsSchema>;
/**
 * RechargeSettingsInput = rechargeSettingsInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type RechargeSettingsInput = z.infer<typeof rechargeSettingsInputSchema>;
