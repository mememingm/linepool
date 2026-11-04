/**
 * admin.ts 中文分区导读副本
 * 原文件：packages/contracts/src/admin.ts
 * 复制日期：2026-11-02
 *
 * 【语言】TypeScript（TS），使用 Zod 工具包描述、检查和整理数据。
 * 【整体用途】后台管理前后端共用的数据约定：查询传什么、操作提交什么、接口返回什么。
 * 【阅读粒度】按功能块理解用途和数据流；需要改具体表达式时，再查它的语法。
 *
 * 【本副本的范围】
 * 保留原文件的完整代码和声明顺序，增加中文注释。
 * 为适应副本所在目录，primitives 的相对导入路径调整为指向原来的文件。
 * 业务代码仍然使用原文件，本副本作为阅读资料；原文件以后有改动时需重新同步。
 * 想改具体值：先看字段旁的“修改提示”；跨文件的修改步骤见 api-guide.md 第 10 节。
 *
 * 【板块目录】
 * 01 引入检查工具和公共规则
 * 02 后台列表的查询条件
 * 03 管理员操作需要提交的数据
 * 04 用户、号码、商品、订单等接口返回数据
 * 05 上游项目、短信回执和接入状态
 * 06 后台首页的汇总数据
 * 07 根据上游资源补建商品
 * 08 导出供 TypeScript 使用的数据类型
 *
 * 【开发时顺着这条链查】
 * src/linepool/admin/AdminShell.tsx：后台页面和用户操作。
 * src/linepool/api/client.ts：前端发起请求，也按这些约定检查请求和响应。
 * backend/src/admin-controller.ts：后端接口入口，检查输入，再交给业务处理。
 * backend/src/administration.ts：查询数据库，执行用户、号码、商品等管理业务。
 * 本文件对应的原文件：admin.ts，集中描述上面这些代码交换的数据格式。
 *
 * 【常见名字】
 * admin = 后台管理；query = 查询条件；input = 提交的数据；schema = 数据检查规则。
 * 写需求时先定位功能块，再看对应字段；字段的英文含义在各块注释中说明。
 */

// ==================== 01 引入检查工具和公共规则 ====================
// Zod 是工具包；z 是它提供的工具入口。后面的 z.object、z.enum 等都用来定义规则。
import { z } from 'zod';
// primitives：项目已有的公共规则，复用它们可以让不同接口采用一致的要求。
// paginationQuerySchema = 分页查询规则，包含 page（页码）和 pageSize（每页条数）。
// regionIdSchema / serviceSchema / planIdSchema = 地区 / 服务平台 / 套餐标识规则。
// uuidSchema / fulfillmentStatusSchema / passwordSchema = 编号格式 / 订单履行状态 / 密码规则。
import { paginationQuerySchema, regionIdSchema, serviceSchema, uuidSchema, planIdSchema, fulfillmentStatusSchema, passwordSchema } from '../../packages/contracts/src/primitives.js';

// ==================== 02 后台列表的查询条件 ====================
/**
 * adminQuerySchema = 后台管理列表的通用查询条件规则。
 * 功能：在分页规则上补充搜索和筛选条件，供用户、号码、商品等后台列表使用。
 * 为什么这样组织：多个列表共享基础条件，分页等规则集中维护，各列表再决定如何筛选。
 * 主要字段：search 搜索词；status 状态；view 查看方式；region 地区；
 * userId 用户编号；provider 供应商来源（pingcode / pingcode-mock）。
 * 分页默认第 1 页、每页 20 条；搜索词和状态默认空文字，其他筛选条件可以不提供。
 * 【修改提示】想让搜索词最多 300 个字符，在原文件把 search 的 max(200) 改为 max(300)。
 * 每页默认条数来自 primitives.ts 的 pageSize.default(20)；页面明确传入条数时，不采用这个默认值。
 */
export const adminQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).default(''),
  status: z.string().max(40).default(''),
  view: z.enum(['today', 'attention']).optional(),
  region: regionIdSchema.optional(),
  userId: uuidSchema.optional(),
  provider: z.enum(['pingcode', 'pingcode-mock']).optional(),
});

// adminOrderViewSchema = 后台订单的查看方式规则：today 今天；attention 需要关注。
export const adminOrderViewSchema = z.enum(['today', 'attention']);
/**
 * adminOrdersQuerySchema = 后台订单列表的专用查询条件规则。
 * 功能：兼容旧链接的筛选写法，再按当前订单查询规则检查数据。
 * 为什么这样组织：旧链接把查看方式放在 status 中，现在用 status 表示履行状态，
 * 用 view 表示“今天 / 需要关注”，两者可以独立筛选。
 * 整段只需先理解为“旧格式整理 → 检查订单查询条件”。
 */
/** Old dashboard links remain usable; fulfillment status and list view are independent. */
export const adminOrdersQuerySchema = z.preprocess(value => {
  // value = 收到的查询数据；缺少可转换的结构时，原样交给后续规则检查。
  if (!value || typeof value !== 'object' || !('status' in value)) return value;
  // legacy = 从旧状态换算出的查看方式：today → today；异常 / 尚未核实 → attention。
  const legacy = value.status === 'today' ? 'today' : ['EXCEPTION', 'UNVERIFIED'].includes(String(value.status)) ? 'attention' : undefined;
  // 有换算结果就清空旧 status；优先保留已有的非空 view，否则采用换算结果。
  return legacy ? { ...value, status: '', view: 'view' in value && value.view ? value.view : legacy } : value;
}, adminQuerySchema.extend({
  // 订单履行状态：处理中 / 已完成 / 失败 / 已取消；空文字表示不按履行状态筛选。
  status: z.enum(['', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).default(''),
  view: adminOrderViewSchema.optional(),
}));
// AdminOrdersQuery = 整理并检查后的订单查询数据类型，供 TypeScript 检查调用代码。
export type AdminOrdersQuery = z.infer<typeof adminOrdersQuerySchema>;

// ==================== 03 管理员操作需要提交的数据 ====================
// 这一块约定管理表单和操作按钮提交的内容；真正执行修改的是后端业务代码。
// 写操作使用 strictObject，按明确列出的字段接收输入，多出来的字段会被拒绝。

/**
 * serviceDurationSchema = 服务时长检查规则。
 * 功能：限制管理员分配号码、创建或编辑商品时，可以提交哪些服务天数。
 * 当前只接受数字 7 或 30；这一行不负责选择页面默认值，也不修改数据库已有商品。
 *
 * 【怎么改成 14 天 / 60 天】
 * 实际修改位置：packages/contracts/src/admin.ts 中的同名这一行。
 * 替换为仅允许 14 天或 60 天：
 * export const serviceDurationSchema = z.union([z.literal(14), z.literal(60)]);
 *
 * 为什么这样改：每个 z.literal(...) 指定一个允许的准确值，z.union([...]) 表示其中任意一个。
 * 所以这里允许的是 14、60 两个选项，不是“14 到 60 天之间都可以”。
 * 此处写数字 14、60，不是文字 '14'、'60'。
 *
 * 如果想保留 7/30 天，并且新增 14/60 天，则改为：
 * export const serviceDurationSchema = z.union([
 *   z.literal(7), z.literal(14), z.literal(30), z.literal(60),
 * ]);
 *
 * 【改完这一行，还要改哪里】
 * 1. AdminShell.tsx：分配与商品表单的选项、提交值转换、默认值、旧商品回填和提示。
 *    例如只保留 14/60 两项时，days === '7' ? 7 : 30 也要改为 days === '14' ? 14 : 60。
 *    这类二选一写法不能用于四个选项；四选一时要逐个保留所选值，详见报告第 10 节。
 * 2. administration.ts：手动分配还有 [7,30] 的额外限制；同步商品也另写了 7/30 套餐。
 * 3. 如果普通用户也要购买：workspace.ts、ordering.ts 和 PurchasePage.tsx 有独立的 7/30 筛选。
 * 4. 已有商品、历史订单、套餐名称与价格不会自动改变，需要单独决定如何处理。
 *
 * 完整位置清单及“只改后台 / 同时开放前台”的范围区别，见 api-guide.md 第 10 节。
 * 本副本下面仍保留当前 7/30 的实际代码，注释中的改法是供以后操作的示例。
 */
export const serviceDurationSchema = z.union([z.literal(7), z.literal(30)]);
// reasonSchema = 操作理由规则：去掉首尾空格后为 3～500 个字符，多个管理操作共用。
// 【修改提示】把原文件 min(3) 改为 min(5)，会要求所有复用本规则的管理操作至少填写 5 个字符。
export const reasonSchema = z.string().trim().min(3).max(500);

// adminPasswordResetInputSchema = 管理员重置用户密码时的输入规则：新密码 + 操作理由。
export const adminPasswordResetInputSchema = z.strictObject({ newPassword: passwordSchema, reason: reasonSchema });
// AdminPasswordResetInput = 对应的“重置密码输入”类型。
export type AdminPasswordResetInput = z.infer<typeof adminPasswordResetInputSchema>;

// userStatusInputSchema = 修改用户状态的输入规则：ACTIVE 启用 / DISABLED 停用 + 理由。
export const userStatusInputSchema = z.strictObject({ status: z.enum(['ACTIVE', 'DISABLED']), reason: reasonSchema });

/**
 * numberActionInputSchema = 管理员操作号码的输入规则，按 action（动作）选择对应字段。
 * assign 分配：提交 userId（目标用户）、durationDays（服务天数）和理由。
 * reclaim 回收：提交 expectedUserId（预期持有人）、expectedAllocationId（预期分配记录）
 * 和理由，供后端核对归属是否已变化，避免依据过期页面信息回收。
 * sale 设置可售状态：提交 saleEnabled（是否允许出售）和理由。
 * 为什么这样组织：三种动作需要的数据不同，用一个入口明确区分各自动作的要求。
 */
export const numberActionInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('assign'), userId: uuidSchema, durationDays: serviceDurationSchema, reason: reasonSchema }),
  z.strictObject({ action: z.literal('reclaim'), expectedUserId: uuidSchema, expectedAllocationId: uuidSchema, reason: reasonSchema }),
  z.strictObject({ action: z.literal('sale'), saleEnabled: z.boolean(), reason: reasonSchema }),
]);

/**
 * productInputSchema = 新建或编辑商品时的输入规则。
 * region / service / plan = 地区 / 服务平台 / 套餐标识；name = 商品名称。
 * durationDays = 服务天数；unitPoints = 单价积分；isActive = 是否启用；
 * areaPrefix = 号码前缀；reason = 修改理由。
 * 此处的商品输入要求 capability（能力）为 RECEIVE（接收），allowRenewal（允许续期）为 false。
 * 为什么这样组织：让新建和编辑商品共用一套字段和限制；保存逻辑见 Administration.saveProduct。
 * 【修改提示】unitPoints 的 max(1000000) 是“允许填写的积分单价上限”，不是商品实际售价。
 * 想把某个商品卖 25 积分，在后台编辑该商品价格；想改新建商品预填价，则查 AdminShell.tsx。
 */
export const productInputSchema = z.strictObject({
  region: regionIdSchema, service: serviceSchema, plan: planIdSchema,
  name: z.string().trim().min(1).max(100), durationDays: serviceDurationSchema,
  unitPoints: z.number().int().min(1).max(1000000), isActive: z.boolean(),
  areaPrefix: z.string().trim().max(20).regex(/^\+?\d*$/),
  capability: z.literal('RECEIVE'),
  allowRenewal: z.literal(false), reason: reasonSchema,
});

// ==================== 04 用户、号码、商品、订单等接口返回数据 ====================
// 这一块描述返回给后台页面的数据结构。加一项页面信息时，可先查这里有没有对应字段。
// 输入规则描述“提交什么”，下面的规则描述“返回什么”，字段名按现有接口保留。

// date = 本文件共用的时间字段规则，当前时间值按文字传输。
const date = z.string();

// adminUserSchema = 后台用户数据规则，供用户列表和用户详情展示。
// 包含身份、角色、启用状态、积分余额，以及演示标记、关联号码数和订单数。
export const adminUserSchema = z.object({
  id: uuidSchema, email: z.string(), display_name: z.string(), role: z.enum(['USER', 'ADMIN']),
  account_status: z.enum(['ACTIVE', 'DISABLED']), created_at: date, points_balance: z.number(),
  is_demo: z.boolean(), number_count: z.number(), order_count: z.number(),
});

/**
 * adminNumberSchema = 后台号码及其平台服务的数据规则。
 * 功能：把号码、供应商、可售状态、持有人和分配信息组合起来，供列表及详情展示。
 * id 是号码的平台服务记录编号；number_id 是底层号码编号，两者用途不同。
 * assigned_user_id / owner_name = 当前持有人编号 / 名称；
 * allocation_id = 分配记录编号；expires_at = 分配到期时间。
 * nullable 表示允许返回 null，例如号码尚未分配时，持有人和分配信息可以为空。
 */
export const adminNumberSchema = z.object({
  id: uuidSchema, number_id: uuidSchema, phone_number: z.string(), region_id: regionIdSchema, country: z.string(), prefix: z.string(),
  provider: z.enum(['pingcode', 'pingcode-mock']), external_number_id: z.string().nullable(),
  external_project_id: z.string(), project_name: z.string(), resource_expires_at: date.nullable(),
  service: serviceSchema, capability: z.string(), resource_status: z.string(), sale_enabled: z.boolean(),
  sale_status: z.string(), assigned_user_id: uuidSchema.nullable(), owner_name: z.string().nullable(),
  allocation_id: uuidSchema.nullable(),
  order_id: uuidSchema.nullable(), expires_at: date.nullable(),
});

// adminProductSchema = 后台商品数据规则，包含套餐配置、价格、库存和上游项目。
// 按当前后端查询：available_count 是 pingcode-mock 来源可用数；
// pc_available_count 是 pingcode 来源可用数，分别返回便于后台区分来源。
export const adminProductSchema = z.object({
  region_id: regionIdSchema, service: serviceSchema, plan: planIdSchema, name: z.string(),
  duration_days: z.number(), unit_points: z.number(), is_active: z.boolean(), country: z.string(),
  area_prefix: z.string(), capability: z.literal('RECEIVE'),
  allow_renewal: z.boolean(), available_count: z.number(), pc_available_count: z.number(),
  pc_project_id: z.string().nullable(), pc_project_name: z.string().nullable(),
});

// adminOrderSchema = 后台订单数据规则，包含购买人、套餐、数量、总积分和完成时间。
// payment_status = 积分支付状态；fulfillment_status = 订单履行状态；
// assigned_count = 已关联的分配记录数。分别展示这些信息，便于判断订单处理到哪一步。
export const adminOrderSchema = z.object({
  id: uuidSchema, order_number: z.string(), user_id: uuidSchema, owner_name: z.string(),
  plan_name: z.string(), quantity: z.number(), total_points: z.number(), created_at: date,
  payment_status: z.string(), fulfillment_status: fulfillmentStatusSchema, completed_at: date.nullable(),
  is_demo: z.boolean(), assigned_count: z.number(),
});

// allocationSchema = 号码分配记录的数据规则：哪个平台的号码，在什么时间分给了谁。
// assigned_at / expires_at / released_at = 分配时间 / 到期时间 / 释放时间，用于详情和历史追溯。
export const allocationSchema = z.object({
  id: uuidSchema, number_id: uuidSchema, platform_id: serviceSchema, user_id: uuidSchema, order_id: uuidSchema.nullable(),
  phone_number: z.string(), owner_name: z.string(), assigned_at: date, expires_at: date, released_at: date.nullable(),
});

// auditSchema = 管理操作审计记录的数据规则，用于追溯“谁、因为什么、修改了什么”。
// actor_name = 操作人；target_id = 操作对象编号；before_data / after_data = 修改前 / 后的数据。
export const auditSchema = z.object({
  id: uuidSchema, actor_name: z.string(), action: z.string(), target_id: z.string(),
  reason: z.string(), before_data: z.unknown(), after_data: z.unknown(), created_at: date,
});

// ==================== 05 上游项目、短信回执和接入状态 ====================
// “上游”指提供号码或推送短信数据的供应商；这里约定后台查看和处理接入信息所用的数据。

// adminProjectSchema = 后台上游项目数据规则：供应商项目对应哪个服务平台、是否启用、
// 上次同步时间，以及关联号码数，用于查看资源来源和平台对应关系。
export const adminProjectSchema = z.object({
  provider: z.enum(['pingcode', 'pingcode-mock']), external_project_id: z.string(),
  project_name: z.string(), platform_id: serviceSchema, platform_name: z.string(),
  is_active: z.boolean(), synced_at: date, number_count: z.number(),
});

/**
 * adminReceiptSchema = 后台短信回执数据规则，供回执列表和排查使用。
 * 包含上游消息编号、项目和号码、持有人、发送方、正文，以及接收和处理时间。
 * processing_status = 处理状态：PENDING 待处理 / IMPORTED 已导入 / UNMATCHED 未匹配。
 * failure_reason = 失败原因；event_id = 关联事件编号；delivery_count = 投递次数。
 * 为什么保留这些字段：后台需要追踪上游消息是否收到、是否导入、是否发生重复投递。
 */
export const adminReceiptSchema = z.object({
  provider: z.enum(['pingcode', 'pingcode-mock']), external_message_id: z.string(),
  external_project_id: z.string().nullable(), external_number_id: z.string().nullable(),
  platform: z.string().nullable(), phone_number: z.string().nullable(), owner_name: z.string().nullable(),
  sender: z.string().nullable(), body: z.string().nullable(), sms_received_at: date.nullable(),
  recorded_at: date, processed_at: date.nullable(),
  processing_status: z.enum(['PENDING', 'IMPORTED', 'UNMATCHED']), failure_reason: z.string().nullable(),
  event_id: z.string().nullable(), delivery_count: z.number(),
});

// adminWebhookRetryInputSchema = 管理员重试处理回执时的输入规则：消息编号 + 操作理由。
// Webhook = 上游主动推送数据的回调接口；实际重试处理由后端 WebhookInbox.route 执行。
export const adminWebhookRetryInputSchema = z.strictObject({
  messageId: z.string().trim().min(1).max(200), reason: reasonSchema,
});
// adminWebhookRetryResultSchema = 重试结果规则，结果可能为“已导入”或“未匹配”。
export const adminWebhookRetryResultSchema = z.object({ status: z.enum(['IMPORTED', 'UNMATCHED']) });

/**
 * adminUpstreamStatusSchema = 后台上游接入状态的数据规则，供接入状态页面展示。
 * environment = 运行环境；providerTransport = 供应商调用模式，此处固定为 mock（模拟）。
 * webhook = 回调路径、是否配置校验密钥、重放校验窗口和重试间隔。
 * receipts = 回执数量、处理结果、最近时间，以及事件数、投递数和重复投递数。
 * 为什么组合在一起：一个状态接口提供接入配置和处理情况，方便后台集中查看。
 * 实际数据由 backend/src/upstream-integration.ts 中的 status 方法组装。
 */
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
// AdminUpstreamStatus / AdminWebhookRetryInput = 上游接入状态 / 回执重试输入的数据类型。
export type AdminUpstreamStatus = z.infer<typeof adminUpstreamStatusSchema>;
export type AdminWebhookRetryInput = z.infer<typeof adminWebhookRetryInputSchema>;

// ==================== 06 后台首页的汇总数据 ====================
/**
 * adminSummarySchema = 后台首页概览数据规则。
 * 功能：把统计数字和几组近期记录合成一份响应，供首页的统计卡片和列表使用。
 * users 用户数；activeNumbers 使用中的号码数；saleNumbers 可售数；
 * expiringNumbers 即将到期数；todayOrders 今日订单数；exceptionOrders 待关注订单数。
 * pcSaleNumbers / demoSaleNumbers = pingcode 来源 / 模拟来源的可售数。
 * recentOrders / expiring / recentAudit = 近期订单 / 即将到期号码 / 近期管理操作。
 * 具体统计口径和数据库查询见 Administration.summary。
 */
export const adminSummarySchema = z.object({
  users: z.number(), activeNumbers: z.number(), saleNumbers: z.number(), expiringNumbers: z.number(),
  pcSaleNumbers: z.number(), demoSaleNumbers: z.number(),
  todayOrders: z.number(),
  recentOrders: z.array(adminOrderSchema), expiring: z.array(adminNumberSchema),
  recentAudit: z.array(auditSchema), exceptionOrders: z.number(),
});

// ==================== 07 根据上游资源补建商品 ====================
/**
 * productOptionSchema = 上游实际有号码的“国家 × 服务平台”组合的数据规则。
 * 功能：提供商品可选组合，以及号码数、可用数和已有商品数，供后台选择和同步使用。
 * 为什么从上游资源生成选项：新建商品时可以对应到已有资源，具体查询见 productOptions。
 */
/** A country × platform combination that upstream projects actually provide numbers for. */
export const productOptionSchema = z.object({
  region: regionIdSchema, country: z.string(), service: serviceSchema,
  numberCount: z.number().int().nonnegative(), availableCount: z.number().int().nonnegative(), productCount: z.number().int().nonnegative(),
});

// productSyncInputSchema = 商品同步操作的输入规则：提交本次操作理由。
// 后端 syncProducts 会按上游组合补建缺少的 7 天 / 30 天商品草稿，初始为未上架状态。
export const productSyncInputSchema = z.strictObject({ reason: reasonSchema });
// productSyncResultSchema = 商品同步结果规则：检查了多少组合、新建了多少商品、新建清单。
export const productSyncResultSchema = z.object({
  optionCount: z.number().int().nonnegative(), createdCount: z.number().int().nonnegative(),
  created: z.array(z.object({ region: regionIdSchema, service: serviceSchema, plan: planIdSchema, name: z.string() })),
});

// ==================== 08 导出供 TypeScript 使用的数据类型 ====================
// 类型名的中文用途与上面的对应规则一致，例如 AdminUser = 后台用户数据类型。
// z.infer 从已有规则得到类型，供编辑器和编译器提示字段、检查调用代码。
// 为什么这样写：数据检查规则和类型共用一个定义，维护字段时可以保持对应。
// 部分类型已紧跟在其规则后面导出，下面集中导出其余类型。
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
