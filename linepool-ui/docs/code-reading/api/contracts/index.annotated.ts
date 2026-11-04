/**
 * index.ts 中文分区导读副本：普通工作台契约与共享导出
 * 原文件：packages/contracts/src/index.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。多数规则使用 Zod 描述输入或返回格式，类型声明供编辑器检查。
 * 【整体用途】描述登录、账户、目录、购买、号码、短信、积分和首页统计的数据格式，同时汇总导出其他契约。
 * 【为什么这样组织】页面与后端共享同名字段和检查规则，减少双方对请求/响应理解不一致。
 * 【调用链】前端 client.ts 与后端 SchemaPipe → 本文件规则；真正查库和执行操作在 backend/src。
 * 【修改提示】改 quantity.max(10) 是放宽单次购买数量，不会增加库存；新增字段要同步请求方、后端处理和返回值。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { z } from 'zod';
import { uuidSchema, timestampSchema, regionIdSchema, serviceSchema, planIdSchema, paginationQuerySchema, passwordSchema } from '../../../../packages/contracts/src/primitives.js';
export * from '../../../../packages/contracts/src/primitives.js';
export * from '../../../../packages/contracts/src/number-services.js';
export * from '../../../../packages/contracts/src/platform-catalog.js';
export * from '../../../../packages/contracts/src/recharge.js';
export * from '../../../../packages/contracts/src/agent-inventory.js';

/**
 * timestamp = 时间格式规则。接口用带时区的时间文字传输，数据库 Date 需要先转为文字。
 */
const timestamp = timestampSchema;
/**
 * ==================== 01 查询条件 ====================
 * listQuerySchema = 通用列表查询规则。复用分页，增加搜索词和地区筛选。
 */
export const listQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).default(''),
  region: regionIdSchema.optional(),
});
/**
 * numbersQuerySchema = 号码列表筛选规则。在通用列表上增加有效/过期/临期状态，以及号码或分配记录定位。
 */
export const numbersQuerySchema = listQuerySchema.extend({
  status: z.enum(['ACTIVE', 'EXPIRED', 'expiring']).optional(),
  numberId: uuidSchema.optional(),
  allocationId: uuidSchema.optional(),
});
/**
 * inboxQuerySchema = 短信收件箱查询规则。可按号码、分配记录、消息编号和未读状态筛选。
 */
export const inboxQuerySchema = listQuerySchema.extend({
  numberId: uuidSchema.optional(),
  allocationId: uuidSchema.optional(),
  messageId: uuidSchema.optional(),
  unread: z.enum(['true', 'false']).optional(),
});
/**
 * pointsQuerySchema = 积分流水查询规则。kind 用 income/expense 区分收入或支出；它不是代理货币账本。
 */
export const pointsQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(['income', 'expense']).optional(),
});
/**
 * ==================== 02 成功响应与错误格式 ====================
 * paginationSchema = 接口返回的分页信息：当前页、每页条数、记录总数和总页数。
 * 字段速读：page 页码；pageSize 每页条数。
 */
export const paginationSchema = z.object({
  page: z.number().int().positive(), pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(),
});
/**
 * dataResponseSchema = 单份数据的返回包装。把具体业务规则包装为 { data: ... }，统一接口外层格式。
 * 字段速读：data 返回的业务数据。
 */
export function dataResponseSchema<T extends z.ZodType>(schema: T) {
  return z.object({ data: schema });
}
/**
 * paginatedResponseSchema = 分页列表的返回包装。统一返回 data 数组和 pagination 分页信息。
 * 字段速读：data 返回的业务数据；pagination 分页信息。
 */
export function paginatedResponseSchema<T extends z.ZodType>(schema: T) {
  return z.object({ data: z.array(schema), pagination: paginationSchema });
}
/**
 * apiErrorSchema = 接口错误格式规则。code 用来让程序识别错误，message 给人阅读，details 可带字段问题。
 * 字段速读：error 错误内容。
 */
export const apiErrorSchema = z.object({ error: z.object({
  code: z.string(), message: z.string(), details: z.unknown().optional(),
}) });
/**
 * ==================== 03 登录、注册与密码找回 ====================
 * emailSchema = 邮箱整理与检查规则。去首尾空格、转小写，再检查格式和长度。
 */
const emailSchema = z.string().trim().toLowerCase().email().max(254);
/**
 * loginInputSchema = 登录提交规则。普通邮箱登录，另允许 admin 演示别名；后端仍会限制别名的使用环境。
 * 字段速读：email 邮箱；password 密码。
 */
export const loginInputSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.union([emailSchema, z.literal('admin')])),
  password: passwordSchema,
});
/**
 * registerInputSchema = 注册提交规则。在登录字段基础上要求正式邮箱与显示名称，不能用 admin 别名注册。
 */
export const registerInputSchema = loginInputSchema.extend({
  email: emailSchema,
  displayName: z.string().trim().min(1).max(80),
});
/**
 * forgotPasswordInputSchema = 找回密码提交规则，只携带邮箱；邮件是否配置、账户是否可用由后端决定。
 * 字段速读：email 邮箱。
 */
export const forgotPasswordInputSchema = z.strictObject({ email: emailSchema });
/**
 * resetPasswordInputSchema = 重置密码提交规则。需要重置令牌和新密码，令牌有效期及单次使用由后端检查。
 * 字段速读：token 重置令牌；newPassword 新密码。
 */
export const resetPasswordInputSchema = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/), newPassword: passwordSchema,
});
/**
 * ForgotPasswordInput = forgotPasswordInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;
/**
 * ResetPasswordInput = resetPasswordInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;
/**
 * userSchema = 登录用户返回规则，包含身份、积分、创建时间和 USER/ADMIN 角色，不返回密码摘要。
 * 字段速读：id 记录编号；email 邮箱；displayName 显示名称；createdAt 创建时间。
 */
export const userSchema = z.object({
  id: uuidSchema, email: z.string().email(), displayName: z.string(),
  isDemo: z.boolean(), pointsBalance: z.number().int().nonnegative(), createdAt: timestamp,
  role: z.enum(['USER', 'ADMIN']).default('USER'),
});
/**
 * ==================== 04 账户与偏好 ====================
 * preferencesSchema = 账户偏好返回规则，包括到期提醒开关和当前固定的 zh-CN 语言标记。
 */
export const preferencesSchema = z.object({
  expiryNotice: z.boolean(), language: z.literal('zh-CN'),
});
/**
 * preferencesInputSchema = 修改偏好的输入规则，目前只允许提交 expiryNotice 到期提醒开关。
 */
export const preferencesInputSchema = z.strictObject({ expiryNotice: z.boolean() });
/**
 * contactPhoneSchema = 联系手机号规则。要求带 + 和国际区号；这里只检查格式，不验证号码真实归属。
 */
export const contactPhoneSchema = z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'Use an international phone number, such as +8613812345678');
/**
 * accountProfileInputSchema = 账户资料修改规则。按 field 区分改名称、邮箱、手机号或密码，敏感修改要求当前密码。
 * 字段速读：displayName 显示名称。
 */
export const accountProfileInputSchema = z.discriminatedUnion('field', [
  z.strictObject({ field: z.literal('displayName'), displayName: registerInputSchema.shape.displayName }),
  z.strictObject({ field: z.literal('email'), email: emailSchema, currentPassword: loginInputSchema.shape.password }),
  z.strictObject({ field: z.literal('phoneNumber'), phoneNumber: contactPhoneSchema, currentPassword: loginInputSchema.shape.password }),
  z.strictObject({ field: z.literal('password'), newPassword: loginInputSchema.shape.password, currentPassword: loginInputSchema.shape.password }),
]);
/**
 * accountSchema = 完整账户资料返回规则。在用户资料上补充偏好、沙盒开关和联系手机号。
 */
export const accountSchema = userSchema.extend({ preferences: preferencesSchema, sandboxEnabled: z.boolean().optional(), phoneNumber: contactPhoneSchema.nullable().default(null) });
/**
 * ==================== 05 商品目录与购买输入 ====================
 * offerSchema = 可售商品返回规则。包含国家、平台、套餐、天数、单价、库存，以及可选美国区号。
 * 字段速读：region 地区；service 服务平台；plan 套餐代号；name 名称；durationDays 服务天数；unitPoints 每个号码的积分单价。
 */
export const offerSchema = z.object({
  region: regionIdSchema, service: serviceSchema, plan: planIdSchema,
  name: z.string(), durationDays: z.number().int().positive(),
  unitPoints: z.number().int().positive(), availableCount: z.number().int().nonnegative(),
  areaCodes: z.array(z.object({ code: z.string().regex(/^[2-9]\d{2}$/), availableCount: z.number().int().nonnegative() })).optional(),
});
/**
 * regionSchema = 国家/地区展示规则，包括名称、电话前缀及可用数量。
 * 字段速读：id 记录编号；name 名称。
 */
export const regionSchema = z.object({
  id: regionIdSchema, name: z.string(), english: z.string(), prefix: z.string(),
  area: z.string(), availableCount: z.number().int().nonnegative(),
});
/**
 * catalogSchema = 购买目录返回规则。汇总地区、平台与商品；isDemo 当前固定 true。
 */
export const catalogSchema = z.object({
  regions: z.array(regionSchema), services: z.array(serviceSchema), offers: z.array(offerSchema), isDemo: z.literal(true),
  platforms: z.array(z.object({ name: z.string(), slug: z.string(), popular: z.boolean(), available: z.boolean() })).optional(),
});
/**
 * createOrderInputSchema = 购买订单输入规则。数量 1～10，必须带幂等编号；只有美国允许选择 areaCode。最终价格由后端查商品决定。
 * 字段速读：region 地区；service 服务平台；plan 套餐代号；quantity 数量；idempotencyKey 防止同一次操作重复执行的请求编号；areaCode 美国区号。
 */
export const createOrderInputSchema = z.strictObject({
  region: regionIdSchema, service: serviceSchema, plan: planIdSchema,
  quantity: z.number().int().min(1).max(10), idempotencyKey: uuidSchema,
  areaCode: z.string().regex(/^[2-9]\d{2}$/).optional(),
}).refine(input => !input.areaCode || input.region === 'us', { message: 'Area code selection is only available for US numbers', path: ['areaCode'] });
/**
 * ==================== 06 号码、订单与短信返回 ====================
 * numberSchema = 用户已分配号码返回规则。包含服务平台、有效期、剩余天数、短信数量以及直接/代理来源。
 * 字段速读：id 记录编号；phoneNumber 电话号码；region 地区；service 服务平台；status 状态；allocationId 号码分配记录编号；source 数据来源；expiresAt 到期时间。
 */
export const numberSchema = z.object({
  id: uuidSchema, phoneNumber: z.string(), region: regionIdSchema, country: z.string(),
  service: serviceSchema, orderId: uuidSchema.nullable(), status: z.enum(['ACTIVE', 'EXPIRED']),
  allocationId: uuidSchema.optional(),
  source: z.enum(['DIRECT', 'AGENT']).optional(), providedBy: z.string().nullable().optional(),
  assignedAt: timestamp, expiresAt: timestamp, remainingDays: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(), unreadCount: z.number().int().nonnegative(),
  isDemo: z.literal(true),
});
/**
 * fulfillmentStatusSchema = 订单履行状态规则。PROCESSING/COMPLETED/FAILED/CANCELLED 分别是处理中/完成/失败/取消。
 */
export const fulfillmentStatusSchema = z.enum(['PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']);
/**
 * orderSchema = 订单返回规则。保留购买时的套餐名称、天数、单价和总积分，不随当前商品编辑自动变化。
 * 字段速读：id 记录编号；orderNumber 订单编号；region 地区；service 服务平台；plan 套餐代号；quantity 数量；unitPoints 每个号码的积分单价；totalPoints 总积分；durationDays 服务天数。
 */
export const orderSchema = z.object({
  id: uuidSchema, orderNumber: z.string(), region: regionIdSchema, country: z.string(),
  service: serviceSchema, plan: planIdSchema, planName: z.string(),
  quantity: z.number().int().positive(), unitPoints: z.number().int().positive(),
  totalPoints: z.number().int().positive(), durationDays: z.number().int().positive(),
  status: fulfillmentStatusSchema, createdAt: timestamp, completedAt: timestamp.nullable().optional(), isDemo: z.literal(true),
  areaCode: z.string().nullable().optional(),
});
/**
 * orderDetailSchema = 订单详情规则。在订单资料上补充本单对应的号码列表。
 */
export const orderDetailSchema = orderSchema.extend({ numbers: z.array(numberSchema) });
/**
 * smsSchema = 短信返回规则。包括内容、验证码、平台、分配编号、接收时间和已读状态。
 * 字段速读：id 记录编号；numberId 号码编号；phoneNumber 电话号码；allocationId 号码分配记录编号。
 */
export const smsSchema = z.object({
  id: uuidSchema, numberId: uuidSchema, phoneNumber: z.string(), sender: z.string(),
  allocationId: uuidSchema.nullable().optional(), platformId: serviceSchema.optional(),
  body: z.string(), verificationCode: z.string().nullable(), receivedAt: timestamp, isRead: z.boolean(),
});
/**
 * markReadInputSchema = 批量标记已读的输入规则。一次提交 1～100 个消息 UUID，实际归属由后端核对。
 * 字段速读：ids 编号列表。
 */
export const markReadInputSchema = z.strictObject({ ids: z.array(uuidSchema).min(1).max(100) });
/**
 * ==================== 07 积分账本与首页汇总 ====================
 * ledgerSchema = 商城积分流水返回规则。delta 是积分变化，balanceAfter 是变化后积分；这里不是代理货币余额。
 * 字段速读：id 记录编号；delta 本次金额或积分变化；balanceAfter 变化后的余额；description 账目说明；createdAt 创建时间。
 */
export const ledgerSchema = z.object({
  id: uuidSchema, type: z.enum(['SEED_CREDIT', 'ORDER_DEBIT', 'ADJUSTMENT']),
  delta: z.number().int(), balanceAfter: z.number().int().nonnegative(),
  description: z.string(), referenceId: uuidSchema.nullable(), createdAt: timestamp,
});
/**
 * pointsResponseSchema = 积分页响应规则。包含当前余额、可选收入/支出合计、流水列表和分页。
 * 字段速读：data 返回的业务数据；pagination 分页信息。
 */
export const pointsResponseSchema = z.object({
  data: z.object({ balance: z.number().int().nonnegative(), income: z.number().int().nonnegative().optional(), expense: z.number().int().nonnegative().optional(), entries: z.array(ledgerSchema) }),
  pagination: paginationSchema,
});
/**
 * dashboardSchema = 工作台首页数据规则。包含积分、有效号码、临期号码、未读短信和最近订单，overview 可补更详细概览。
 */
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
/**
 * ==================== 08 导出数据类型 ====================
 * LoginInput = loginInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type LoginInput = z.infer<typeof loginInputSchema>;
/**
 * RegisterInput = registerInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type RegisterInput = z.infer<typeof registerInputSchema>;
/**
 * User = userSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type User = z.infer<typeof userSchema>;
/**
 * CreateOrderInput = createOrderInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;
/**
 * AssignedNumber = numberSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AssignedNumber = z.infer<typeof numberSchema>;
/**
 * Order = orderSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type Order = z.infer<typeof orderSchema>;
/**
 * OrderDetail = orderDetailSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type OrderDetail = z.infer<typeof orderDetailSchema>;
/**
 * SmsMessage = smsSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type SmsMessage = z.infer<typeof smsSchema>;
/**
 * LedgerEntry = ledgerSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type LedgerEntry = z.infer<typeof ledgerSchema>;
/**
 * PaginationQuery = paginationQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
/**
 * ListQuery = listQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type ListQuery = z.infer<typeof listQuerySchema>;
/**
 * NumbersQuery = numbersQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type NumbersQuery = z.infer<typeof numbersQuerySchema>;
/**
 * InboxQuery = inboxQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type InboxQuery = z.infer<typeof inboxQuerySchema>;
/**
 * PointsQuery = pointsQuerySchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type PointsQuery = z.infer<typeof pointsQuerySchema>;
/**
 * Account = accountSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type Account = z.infer<typeof accountSchema>;
/**
 * AccountProfileInput = accountProfileInputSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type AccountProfileInput = z.infer<typeof accountProfileInputSchema>;
/**
 * Catalog = catalogSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type Catalog = z.infer<typeof catalogSchema>;
/**
 * Dashboard = dashboardSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type Dashboard = z.infer<typeof dashboardSchema>;
/**
 * PaginatedResponse = paginationSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type PaginatedResponse<T> = { data: T[]; pagination: z.infer<typeof paginationSchema> };
