/**
 * number-services.ts 中文分区导读副本：号码续期与用量契约
 * 原文件：packages/contracts/src/number-services.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。多数规则使用 Zod 描述输入或返回格式，类型声明供编辑器检查。
 * 【整体用途】定义续期选项、续期请求、续期记录以及短信/语音/流量用量的格式。
 * 【为什么这样组织】内部契约独立于供应商报文，适配器负责转换；null、0 和无限额度有不同含义。
 * 【调用链】client.ts → NumberServicesController → NumberServices → NumberServiceProvider。
 * 【修改提示】续期天数检查允许 1～365，但当前 NumberServices.options/create 返回 RENEWAL_DISABLED；改规则或模拟选项不会开放续期。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { z } from 'zod';

// LINEPOOL's internal contract, deliberately independent of any supplier's wire format.
/**
 * ==================== 01 公共格式 ====================
 * timestamp = 时间格式规则。接口用带时区的时间文字传输，数据库 Date 需要先转为文字。
 */
const timestamp = z.string().datetime({ offset: true });
/**
 * uuid = 编号格式规则。检查用户、号码、记录等编号是否符合 UUID 格式。
 */
const uuid = z.string().uuid();
/**
 * ==================== 02 续期选项、请求与记录 ====================
 * dataSourceSchema = 数据来源规则。mock 是模拟数据，live 是真实来源；来源标签本身不等于操作已完成。
 */
export const dataSourceSchema = z.enum(['mock', 'live']);
/**
 * renewalDurationSchema = 续期天数检查规则。允许 1～365 的整数；这是格式范围，当前业务接口仍禁止续期。
 */
export const renewalDurationSchema = z.number().int().min(1).max(365);
/**
 * renewalOptionSchema = 一个续期选项的返回规则。包括天数、可缺失的积分报价与预计到期时间；null 报价不表示免费。
 * 字段速读：durationDays 服务天数；totalPoints 总积分；estimatedExpiresAt 预计到期时间。
 */
export const renewalOptionSchema = z.object({
  durationDays: renewalDurationSchema,
  totalPoints: z.number().int().positive().nullable(),
  estimatedExpiresAt: timestamp,
});
/**
 * renewalOptionsSchema = 续期选项整体返回规则。包含号码、原到期时间、来源和可选期限列表。
 * 字段速读：numberId 号码编号；currentExpiresAt 当前到期时间；source 数据来源；options 可选项。
 */
export const renewalOptionsSchema = z.object({
  numberId: uuid, currentExpiresAt: timestamp, source: dataSourceSchema,
  options: z.array(renewalOptionSchema),
});
/**
 * createRenewalInputSchema = 提交续期的输入规则。带天数、原到期时间和幂等编号，供业务确认状态是否改变。
 * 字段速读：durationDays 服务天数；originalExpiresAt 原到期时间；idempotencyKey 防止同一次操作重复执行的请求编号。
 */
export const createRenewalInputSchema = z.strictObject({
  durationDays: renewalDurationSchema, originalExpiresAt: timestamp, idempotencyKey: uuid,
});
/**
 * renewalRecordSchema = 续期记录返回规则。预计时间与已确认时间分开；SUCCESS 必须来自 live 且有确认到期时间。
 * 字段速读：id 记录编号；numberId 号码编号；phoneNumber 电话号码；durationDays 服务天数；originalExpiresAt 原到期时间；estimatedExpiresAt 预计到期时间；confirmedExpiresAt 已确认到期时间；totalPoints 总积分；status 状态。
 */
export const renewalRecordSchema = z.object({
  id: uuid, renewalNumber: z.string(), numberId: uuid, phoneNumber: z.string(),
  durationDays: renewalDurationSchema, originalExpiresAt: timestamp,
  estimatedExpiresAt: timestamp.nullable(), confirmedExpiresAt: timestamp.nullable(),
  totalPoints: z.number().int().positive().nullable(),
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED']), source: dataSourceSchema,
  failureReason: z.string().nullable(), createdAt: timestamp,
}).refine(record => record.status !== 'SUCCESS' || (record.source === 'live' && record.confirmedExpiresAt !== null), {
  message: 'A successful renewal requires a live confirmation and confirmed expiry',
});
/**
 * ==================== 03 用量场景与额度 ====================
 * usageScenarioSchema = 模拟用量场景规则。standard 普通额度、unlimited 无限量，另有无套餐、不支持和错误三种状态。
 */
export const usageScenarioSchema = z.enum(['standard', 'unlimited', 'no_package', 'unsupported', 'error']);
/**
 * usageQuerySchema = 用量查询参数规则。允许指定可选模拟场景，不接受多余字段。
 * 字段速读：scenario 模拟场景。
 */
export const usageQuerySchema = z.strictObject({ scenario: usageScenarioSchema.optional() });
/**
 * amount = 用量数值规则。要求有限的非负数字；0 与缺失或无限额度分开表达。
 */
const amount = z.number().finite().nonnegative();
/**
 * meteredUsageSchema = 有限额度用量规则。包括总量、已用和剩余，并检查剩余是否符合 max(0,总量-已用)。
 * 字段速读：kind 类别；total 总额度；used 已用额度；remaining 剩余额度。
 */
const meteredUsageSchema = z.object({
  kind: z.literal('metered'), total: amount, used: amount, remaining: amount,
}).refine(item => Math.abs(item.remaining - Math.max(0, item.total - item.used)) < 0.000001, {
  message: 'Remaining usage must agree with the total and used amounts',
});
/**
 * usageQuotaSchema = 按 kind 区分的额度规则。有限额度、无限额度、无套餐、不支持和读取错误各有不同字段。
 * 字段速读：kind 类别；used 已用额度。
 */
export const usageQuotaSchema = z.discriminatedUnion('kind', [
  meteredUsageSchema,
  z.object({ kind: z.literal('unlimited'), used: amount.nullable() }),
  z.object({ kind: z.enum(['no_package', 'unsupported', 'error']) }),
]);
/**
 * numberUsageSchema = 号码用量整体返回规则。短信、语音和流量分别使用额度规则，更新时间可为空。
 * 字段速读：numberId 号码编号；source 数据来源；updatedAt 更新时间；sms 短信用量；voice 语音用量；data 返回的业务数据。
 */
export const numberUsageSchema = z.object({
  numberId: uuid, source: dataSourceSchema, updatedAt: timestamp.nullable(),
  sms: usageQuotaSchema, voice: usageQuotaSchema, data: usageQuotaSchema,
});
/**
 * ==================== 04 导出数据类型 ====================
 * RenewalOptions = renewalOptionsSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type RenewalOptions = z.infer<typeof renewalOptionsSchema>;
/**
 * CreateRenewalInput = createRenewalInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type CreateRenewalInput = z.infer<typeof createRenewalInputSchema>;
/**
 * RenewalRecord = renewalRecordSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type RenewalRecord = z.infer<typeof renewalRecordSchema>;
/**
 * NumberUsage = numberUsageSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type NumberUsage = z.infer<typeof numberUsageSchema>;
/**
 * UsageQuota = usageQuotaSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type UsageQuota = z.infer<typeof usageQuotaSchema>;
/**
 * UsageScenario = usageScenarioSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type UsageScenario = z.infer<typeof usageScenarioSchema>;
/**
 * UsageQuery = usageQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type UsageQuery = z.infer<typeof usageQuerySchema>;
