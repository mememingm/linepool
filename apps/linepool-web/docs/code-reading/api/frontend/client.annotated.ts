/**
 * client.ts 中文分区导读副本：前端接口调用入口
 * 原文件：src/linepool/api/client.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。前端使用浏览器 fetch 发送请求，或使用查询工具管理结果缓存。
 * 【整体用途】把页面需要的查询与操作封装成可调用的方法：检查输入 → 发送 HTTP 请求 → 检查响应 → 交给页面。
 * 【为什么这样组织】所有方法共用地址、Cookie、超时和错误处理，避免各页面重复实现通信逻辑。
 * 【调用链】页面调用 api.xxx → 本文件 request → 后端 Controller；输入/响应格式见共享 contracts。
 * 【修改提示】改服务地址看 baseUrl；改默认超时看 timeoutMs（毫秒）；改某业务字段时同步契约、Controller 和业务层。批量操作有独立 120000 毫秒超时。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { z } from 'zod';
import { adminQuerySchema, adminOrdersQuerySchema, adminSummarySchema, adminUserSchema, adminNumberSchema, adminOrderSchema,
  adminPasswordResetInputSchema, type AdminPasswordResetInput,
  allocationSchema, productInputSchema, numberActionInputSchema, userStatusInputSchema,
  adminUpstreamStatusSchema, adminWebhookRetryInputSchema, adminWebhookRetryResultSchema,
  productOptionSchema, productSyncInputSchema, productSyncResultSchema, type ProductSyncInput,
  type AdminQuery, type NumberActionInput, type ProductInput, type UserStatusInput } from '@linepool/contracts/admin';
import {
  accountProfileInputSchema, accountSchema, apiErrorSchema, catalogSchema, createOrderInputSchema, dashboardSchema,
  dataResponseSchema, inboxQuerySchema, listQuerySchema, loginInputSchema, markReadInputSchema,
  numberSchema, numbersQuerySchema, orderDetailSchema, orderSchema, paginatedResponseSchema,
  pointsQuerySchema, pointsResponseSchema, preferencesInputSchema, preferencesSchema,
  forgotPasswordInputSchema, resetPasswordInputSchema, type ForgotPasswordInput, type ResetPasswordInput,
  registerInputSchema, smsSchema, userSchema, uuidSchema, rechargeOverviewSchema,
  rechargeRecordSchema, rechargeQuerySchema, rechargeSettingsSchema, rechargeSettingsInputSchema,
  type RechargeSettingsInput, type RechargeQuery, upsertPriceRuleInputSchema, transferBalanceInputSchema,
  createRenewalInputSchema, renewalOptionsSchema, renewalRecordSchema, numberUsageSchema, usageQuerySchema, paginationQuerySchema, paginationSchema,
  agentInventoryQuerySchema, agentNumberImportInputSchema, agentNumberStockSchema, agentSchema, agentStockCountsSchema, agentStockQuerySchema, balanceAccountSchema, assignHoldingInputSchema, claimAgentNumberInputSchema, claimAgentNumbersInputSchema, customerSchema, numberHoldingSchema, priceRuleSchema, releaseHoldingInputSchema, resellHoldingInputSchema, txOrderSchema,
  settlementQuoteInputSchema, settlementQuoteSchema, settlementOrderDetailSchema, platformSettlementSchema, holdingBatchInputSchema, holdingBatchPreviewInputSchema, holdingBatchPreviewSchema, holdingBatchResultSchema,
  createAgentInputSchema, createCustomerInputSchema, createHoldingInputSchema, adjustBalanceInputSchema,
  agentContextSchema, agentDashboardSchema, agentMetricPeriodSchema, subagentSchema, subagentsQuerySchema, createSubagentInputSchema, updateAgentNameInputSchema,
  subagentStatusInputSchema, holdingTransferSchema, transferableHoldingSchema, agentTransactionsQuerySchema, updateCustomerInputSchema,
  type OwnerRef, type UpsertPriceRuleInput, type TransferBalanceInput,
  type CreateRenewalInput, type UsageQuery, type PaginationQuery,
  type AccountProfileInput, type CreateOrderInput, type LoginInput, type RegisterInput,
} from '../../../../src/linepool/api/contracts';

/**
 * ==================== 01 接口错误与配置 ====================
 * LinepoolApiError = 项目接口错误。把 HTTP 状态、业务错误编号、文字说明与详情带给页面，页面可以按 code 处理不同情况。
 */
export class LinepoolApiError extends Error {
  /**
   * constructor = 创建接口错误时保存状态、编号、说明与详情；super(message) 让它仍具有普通 Error 的消息和堆栈能力。
   */
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'LinepoolApiError';
  }
}
/**
 * ApiRequestOptions = 单次请求选项。signal 用来在切换页面等情况下取消请求。
 */
export type ApiRequestOptions = { signal?: AbortSignal };
/**
 * ApiClientConfiguration = 接口工具的配置。baseUrl 是后端基础地址，timeoutMs 是默认等待时间，单位毫秒。
 */
export type ApiClientConfiguration = { baseUrl?: string; timeoutMs?: number };
/**
 * ==================== 02 创建调用工具与公共请求 ====================
 * createLinepoolApi = 创建接口调用工具。返回后面的各业务方法；先看内部 request，再按需求查某一个方法。
 */
export function createLinepoolApi(configuration: ApiClientConfiguration = {}) {
  /**
   * baseUrl = 后端基础地址。优先用调用方配置，其次环境配置，最后使用 /api。
   */
  const baseUrl = (configuration.baseUrl ?? import.meta.env.VITE_LINEPOOL_API_URL ?? '/api').replace(/\/$/, '');
  /**
   * timeoutMs = 默认等待时间。15000 毫秒等于 15 秒；单次请求显式指定的超时优先。
   */
  const timeoutMs = configuration.timeoutMs ?? 15000;
  /**
   * request = 统一发送请求。组合地址、传 Cookie、发送 JSON；把失败分成接口错误、超时与网络错误，并检查成功响应是否符合规则。
   */
  async function request<T extends z.ZodType>(
    path: string, schema: T, options: ApiRequestOptions & { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown; timeoutMs?: number } = {},
  ): Promise<z.infer<T>> {
    // 取消与超时：页面主动取消和等待超时共用这个控制器；finally 会清理计时器与事件监听。
    const controller = new AbortController();
    const relayAbort = () => controller.abort(options.signal?.reason);
    const timeout = setTimeout(() => controller.abort(new DOMException('Request timeout', 'TimeoutError')), options.timeoutMs ?? timeoutMs);
    if (options.signal?.aborted) relayAbort();
    options.signal?.addEventListener('abort', relayAbort, { once: true });
    try {
      // 真正发送 HTTP 请求。credentials:include 携带登录 Cookie，请求体存在时转成 JSON；此处不包含自动重试循环。
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET', credentials: 'include', signal: controller.signal,
        cache: 'no-store',
        headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const payload: unknown = await response.json().catch(() => null);
      // 后端返回非成功状态：优先读取统一的业务错误 code/message；报文不符合错误约定时退回 HTTP_ERROR。
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(payload);
        const error = parsed.success ? parsed.data.error : { code: 'HTTP_ERROR', message: `HTTP ${response.status}` };
        throw new LinepoolApiError(response.status, error.code, error.message, 'details' in error ? error.details : undefined);
      }
      // 成功 HTTP 状态仍要检查业务字段。缺字段或类型不符时抛 INVALID_RESPONSE，避免页面使用错误结构。
      const parsed = schema.safeParse(payload);
      if (!parsed.success) throw new LinepoolApiError(response.status, 'INVALID_RESPONSE', 'API response does not match the contract');
      return parsed.data;
    } catch (error) {
      if (error instanceof LinepoolApiError || options.signal?.aborted) throw error;
      if (controller.signal.aborted) throw new LinepoolApiError(0, 'REQUEST_TIMEOUT', 'Request timed out');
      throw new LinepoolApiError(0, 'NETWORK_ERROR', 'Unable to reach the API');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', relayAbort);
    }
  }
  /**
   * query = 查询条件转网址参数。把页码、搜索词等转成 ? 后的参数，忽略 undefined 和空文字。
   */
  const query = (values: Record<string, unknown>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
    return `?${params.toString()}`;
  };
  return {
    /**
     * ==================== 03 本地沙盒调用 ====================
     * sandboxStatus = 查询本地沙盒是否开放。请求：GET /sandbox（前面拼接 baseUrl）。
     */
    sandboxStatus(options?: ApiRequestOptions) { return request('/sandbox', dataResponseSchema(z.object({enabled:z.boolean()})), options); },
    /**
     * sandboxCredit = 执行本地沙盒积分操作。请求：POST /sandbox/credit（前面拼接 baseUrl）。
     */
    sandboxCredit() { return request('/sandbox/credit', dataResponseSchema(z.object({status:z.string()})), {method:'POST',body:{}}); },
    /**
     * sandboxFulfill = 模拟订单履行结果。请求：POST /sandbox/fulfill（前面拼接 baseUrl）。
     */
    sandboxFulfill(orderId:string,outcome:'SUCCESS'|'FAILED'|'UNKNOWN') { return request('/sandbox/fulfill',dataResponseSchema(z.object({status:z.string()})),{method:'POST',body:{orderId,outcome}}); },
    /**
     * sandboxInbound = 模拟接收短信结果。请求：POST /sandbox/inbound（前面拼接 baseUrl）。
     */
    sandboxInbound(input:{id:string;numberId:string;allocationId?:string;outcome:'SUCCESS'|'FAILED'|'UNKNOWN';resolve?:boolean}) { return request('/sandbox/inbound',dataResponseSchema(z.object({status:z.string()})),{method:'POST',body:input}); },
    /**
     * ==================== 04 后台会话、统计与列表 ====================
     * adminSession = 确认后台会话和管理员身份。请求：GET /admin/session（前面拼接 baseUrl）。
     */
    adminSession(options?: ApiRequestOptions) { return request('/admin/session', dataResponseSchema(userSchema), options); },
    /**
     * adminSummary = 查询后台首页统计。请求：GET /admin/summary（前面拼接 baseUrl）。
     */
    adminSummary(options?: ApiRequestOptions) { return request('/admin/summary', dataResponseSchema(adminSummarySchema), options); },
    /**
     * adminUpstreamStatus = 查询上游接入配置和回执处理统计。请求：GET /admin/integrations/pingcode（前面拼接 baseUrl）。
     */
    adminUpstreamStatus(options?: ApiRequestOptions) {
      return request('/admin/integrations/pingcode', dataResponseSchema(adminUpstreamStatusSchema), options);
    },
    /**
     * adminRetryWebhook = 重试处理指定短信回执。请求：POST /admin/integrations/pingcode/retry（前面拼接 baseUrl）。
     */
    adminRetryWebhook(input: z.input<typeof adminWebhookRetryInputSchema>) {
      return request('/admin/integrations/pingcode/retry', dataResponseSchema(adminWebhookRetryResultSchema), {
        method: 'POST', body: adminWebhookRetryInputSchema.parse(input),
      });
    },
    /**
     * adminRechargeSettings = 查询充值规则配置。请求：GET /admin/recharge-settings（前面拼接 baseUrl）。
     */
    adminRechargeSettings(options?: ApiRequestOptions) { return request('/admin/recharge-settings', dataResponseSchema(rechargeSettingsSchema), options); },
    /**
     * adminSaveRechargeSettings = 保存充值规则配置。请求：PATCH /admin/recharge-settings（前面拼接 baseUrl）。
     */
    adminSaveRechargeSettings(input: RechargeSettingsInput) {
      return request('/admin/recharge-settings', dataResponseSchema(rechargeSettingsSchema), { method: 'PATCH', body: rechargeSettingsInputSchema.parse(input) });
    },
    /**
     * adminList = 查询用户、号码、商品、订单、审计、项目或回执列表。请求：GET /admin/${section}${query((section === 'orders' ? adminOrdersQuerySchema : adminQuerySchema).parse(input))}（前面拼接 baseUrl）。section 决定后台板块；订单使用专用查询规则，返回带分页的列表。
     */
    adminList<T extends z.ZodType>(section: string, schema: T, input: Partial<AdminQuery>, options?: ApiRequestOptions) {
      return request(`/admin/${section}${query((section === 'orders' ? adminOrdersQuerySchema : adminQuerySchema).parse(input))}`, paginatedResponseSchema(schema), options);
    },
    /**
     * ==================== 05 代理身份、下级与客户 ====================
     * agentContext = 查询当前代理业务身份和上下文。请求：GET /agent-inventory/context（前面拼接 baseUrl）。
     */
    agentContext(options?: ApiRequestOptions) {
      return request('/agent-inventory/context', dataResponseSchema(agentContextSchema), options);
    },
    /**
     * agentUpdateProfile = 修改当前代理资料。请求：PATCH /agent-inventory/profile（前面拼接 baseUrl）。
     */
    agentUpdateProfile(input: z.input<typeof updateAgentNameInputSchema>) {
      return request('/agent-inventory/profile', dataResponseSchema(agentSchema), { method: 'PATCH', body: updateAgentNameInputSchema.parse(input) });
    },
    /**
     * agentUpdateCustomer = 修改客户资料。请求：PATCH /agent-inventory/customers/${uuidSchema.parse(id)}（前面拼接 baseUrl）。
     */
    agentUpdateCustomer(id: string, input: z.input<typeof updateCustomerInputSchema>) {
      return request(`/agent-inventory/customers/${uuidSchema.parse(id)}`, dataResponseSchema(customerSchema), { method: 'PATCH', body: updateCustomerInputSchema.parse(input) });
    },
    /**
     * agentPlatformSettlement = 查询平台结算汇总。请求：GET /agent-inventory/platform-settlement${query({ period: agentMetricPeriodSchema.parse(period) })}（前面拼接 baseUrl）。
     */
    agentPlatformSettlement(period: z.input<typeof agentMetricPeriodSchema> = '7d', options?: ApiRequestOptions) {
      return request(`/agent-inventory/platform-settlement${query({ period: agentMetricPeriodSchema.parse(period) })}`, dataResponseSchema(platformSettlementSchema), options);
    },
    /**
     * agentDashboard = 查询代理业务概览。请求：GET /agent-inventory/dashboard${query({ period: agentMetricPeriodSchema.parse(period) })}（前面拼接 baseUrl）。
     */
    agentDashboard(period: z.input<typeof agentMetricPeriodSchema> = '7d', options?: ApiRequestOptions) {
      return request(`/agent-inventory/dashboard${query({ period: agentMetricPeriodSchema.parse(period) })}`, dataResponseSchema(agentDashboardSchema), options);
    },
    /**
     * agentSubagents = 查询下级代理列表。请求：GET /agent-inventory/subagents${query(subagentsQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    agentSubagents(input: z.input<typeof subagentsQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/subagents${query(subagentsQuerySchema.parse(input))}`, paginatedResponseSchema(subagentSchema), options);
    },
    /**
     * agentSubagent = 查询下级代理详情。请求：GET /agent-inventory/subagents/${uuidSchema.parse(id)}（前面拼接 baseUrl）。
     */
    agentSubagent(id: string, options?: ApiRequestOptions) {
      return request(`/agent-inventory/subagents/${uuidSchema.parse(id)}`, dataResponseSchema(subagentSchema), options);
    },
    /**
     * agentCreateSubagent = 创建下级代理。请求：POST /agent-inventory/subagents（前面拼接 baseUrl）。
     */
    agentCreateSubagent(input: z.input<typeof createSubagentInputSchema>) {
      return request('/agent-inventory/subagents', dataResponseSchema(subagentSchema), { method: 'POST', body: createSubagentInputSchema.parse(input) });
    },
    /**
     * agentRenameSubagent = 修改下级代理名称。请求：PATCH /agent-inventory/subagents/${uuidSchema.parse(id)}/name（前面拼接 baseUrl）。
     */
    agentRenameSubagent(id: string, input: z.input<typeof updateAgentNameInputSchema>) {
      return request(`/agent-inventory/subagents/${uuidSchema.parse(id)}/name`, dataResponseSchema(subagentSchema), { method: 'PATCH', body: updateAgentNameInputSchema.parse(input) });
    },
    /**
     * agentSubagentStatus = 修改下级代理状态。请求：PATCH /agent-inventory/subagents/${uuidSchema.parse(id)}/status（前面拼接 baseUrl）。
     */
    agentSubagentStatus(id: string, input: z.input<typeof subagentStatusInputSchema>) {
      return request(`/agent-inventory/subagents/${uuidSchema.parse(id)}/status`, dataResponseSchema(z.object({ changed: z.boolean(), agentId: uuidSchema, status: z.string() })), { method: 'PATCH', body: subagentStatusInputSchema.parse(input) });
    },
    /**
     * agentSubagentHoldings = 查询下级代理相关持有记录。请求：GET /agent-inventory/subagents/${uuidSchema.parse(id)}/holdings${query(paginationQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    agentSubagentHoldings(id: string, input: z.input<typeof paginationQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/subagents/${uuidSchema.parse(id)}/holdings${query(paginationQuerySchema.parse(input))}`, paginatedResponseSchema(holdingTransferSchema), options);
    },
    /**
     * agentSubagentTransactions = 查询下级代理交易记录。请求：GET /agent-inventory/subagents/${uuidSchema.parse(id)}/transactions${query(paginationQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    agentSubagentTransactions(id: string, input: z.input<typeof paginationQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/subagents/${uuidSchema.parse(id)}/transactions${query(paginationQuerySchema.parse(input))}`, paginatedResponseSchema(txOrderSchema), options);
    },
    /**
     * agentTransferableHoldings = 查询可转移的持有记录。请求：GET /agent-inventory/transferable-holdings${query(agentInventoryQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    agentTransferableHoldings(input: z.input<typeof agentInventoryQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/transferable-holdings${query(agentInventoryQuerySchema.parse(input))}`, dataResponseSchema(z.array(transferableHoldingSchema)), options);
    },
    /**
     * agentAgents = 查询可见代理列表。请求：GET /agent-inventory/agents（前面拼接 baseUrl）。
     */
    agentAgents(options?: ApiRequestOptions) {
      return request('/agent-inventory/agents', dataResponseSchema(z.array(agentSchema)), options);
    },
    /**
     * agentCustomers = 查询客户列表。请求：GET /agent-inventory/customers（前面拼接 baseUrl）。
     */
    agentCustomers(options?: ApiRequestOptions) {
      return request('/agent-inventory/customers', dataResponseSchema(z.array(customerSchema)), options);
    },
    /**
     * agentCustomerHoldings = 查询客户持有的号码。请求：GET /agent-inventory/customers/${uuidSchema.parse(customerId)}/holdings${query(paginationQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    agentCustomerHoldings(customerId: string, input: z.input<typeof paginationQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/customers/${uuidSchema.parse(customerId)}/holdings${query(paginationQuerySchema.parse(input))}`, paginatedResponseSchema(numberHoldingSchema), options);
    },
    /**
     * ==================== 06 库存领用与号码流转 ====================
     * agentHoldings = 查询持有记录。请求：GET /agent-inventory/holdings${query(agentInventoryQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    agentHoldings(input: z.input<typeof agentInventoryQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/holdings${query(agentInventoryQuerySchema.parse(input))}`, paginatedResponseSchema(numberHoldingSchema), options);
    },
    /**
     * agentStock = 查询统一号码库存和库存统计。请求：GET /agent-inventory/stock${query(agentStockQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    agentStock(input: z.input<typeof agentStockQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/stock${query(agentStockQuerySchema.parse(input))}`, paginatedResponseSchema(agentNumberStockSchema).extend({ counts: agentStockCountsSchema }), options);
    },
    /**
     * agentImportStock = 导入号码库存。请求：POST /agent-inventory/stock/import（前面拼接 baseUrl）。
     */
    agentImportStock(input: z.input<typeof agentNumberImportInputSchema>) {
      return request('/agent-inventory/stock/import', dataResponseSchema(z.object({ idempotencyKey: uuidSchema, importedCount: z.number().int().nonnegative(), replayed: z.boolean(), items: z.array(agentNumberStockSchema) })), { method: 'POST', body: agentNumberImportInputSchema.parse(input) });
    },
    /**
     * agentClaimStock = 领用单个库存号码。请求：POST /agent-inventory/stock/claim（前面拼接 baseUrl）。
     */
    agentClaimStock(input: z.input<typeof claimAgentNumberInputSchema>) {
      return request('/agent-inventory/stock/claim', dataResponseSchema(z.object({ holding: numberHoldingSchema, stock: agentNumberStockSchema, replayed: z.boolean() })), { method: 'POST', body: claimAgentNumberInputSchema.parse(input) });
    },
    /**
     * agentClaimStockBatch = 批量领用库存号码。请求：POST /agent-inventory/stock/claim-batch（前面拼接 baseUrl）。
     */
    agentClaimStockBatch(input: z.input<typeof claimAgentNumbersInputSchema>) {
      return request('/agent-inventory/stock/claim-batch', dataResponseSchema(z.object({ holdings: z.array(numberHoldingSchema), stocks: z.array(agentNumberStockSchema), replayed: z.boolean() })), { method: 'POST', body: claimAgentNumbersInputSchema.parse(input) });
    },
    /**
     * agentReleaseHolding = 释放持有记录并回收库存。请求：POST /agent-inventory/holdings/${uuidSchema.parse(id)}/release（前面拼接 baseUrl）。
     */
    agentReleaseHolding(id: string, input: z.input<typeof releaseHoldingInputSchema>) {
      return request(`/agent-inventory/holdings/${uuidSchema.parse(id)}/release`, dataResponseSchema(z.object({ stock: agentNumberStockSchema, releasedHoldingId: uuidSchema })), { method: 'POST', body: releaseHoldingInputSchema.parse(input) });
    },
    /**
     * agentHoldingBatchPreview = 预览批量流转的选择和结果。请求：POST /agent-inventory/holdings/batch-preview（前面拼接 baseUrl）。单独设置 120000 毫秒超时，改公共默认值不会覆盖这里。
     */
    agentHoldingBatchPreview(input: z.input<typeof holdingBatchPreviewInputSchema>) {
      return request('/agent-inventory/holdings/batch-preview', dataResponseSchema(holdingBatchPreviewSchema), { method: 'POST', body: holdingBatchPreviewInputSchema.parse(input), timeoutMs: 120000 });
    },
    /**
     * agentTransferHoldingBatch = 执行批量流转。请求：POST /agent-inventory/holdings/batch-transfer（前面拼接 baseUrl）。单独设置 120000 毫秒超时，改公共默认值不会覆盖这里。
     */
    agentTransferHoldingBatch(input: z.input<typeof holdingBatchInputSchema>) {
      return request('/agent-inventory/holdings/batch-transfer', dataResponseSchema(holdingBatchResultSchema), { method: 'POST', body: holdingBatchInputSchema.parse(input), timeoutMs: 120000 });
    },
    /**
     * agentAssignHoldingToCustomer = 将号码分配给客户。请求：POST /agent-inventory/holdings/assign-customer（前面拼接 baseUrl）。
     */
    agentAssignHoldingToCustomer(input: z.input<typeof assignHoldingInputSchema>) {
      return request('/agent-inventory/holdings/assign-customer', dataResponseSchema(z.object({ holding: numberHoldingSchema, orderId: uuidSchema, replayed: z.boolean() })), { method: 'POST', body: assignHoldingInputSchema.parse(input) });
    },
    /**
     * agentResellHolding = 转售号码持有记录。请求：POST /agent-inventory/holdings/resell（前面拼接 baseUrl）。
     */
    agentResellHolding(input: z.input<typeof resellHoldingInputSchema>) {
      return request('/agent-inventory/holdings/resell', dataResponseSchema(z.object({ holding: numberHoldingSchema, orderId: uuidSchema, replayed: z.boolean() })), { method: 'POST', body: resellHoldingInputSchema.parse(input) });
    },
    /**
     * ==================== 07 余额、报价与交易查询 ====================
     * agentBalances = 查询可见余额账户。请求：GET /agent-inventory/balances（前面拼接 baseUrl）。
     */
    agentBalances(options?: ApiRequestOptions) {
      return request('/agent-inventory/balances', dataResponseSchema(z.array(balanceAccountSchema)), options);
    },
    /**
     * agentSettlementPreview = 预览结算报价。请求：POST /agent-inventory/settlement-preview（前面拼接 baseUrl）。
     */
    agentSettlementPreview(input: z.input<typeof settlementQuoteInputSchema>, options?: ApiRequestOptions) {
      return request('/agent-inventory/settlement-preview', dataResponseSchema(settlementQuoteSchema), { ...options, method: 'POST', body: settlementQuoteInputSchema.parse(input) });
    },
    /**
     * agentPriceOptions = 查询价格配置可用的平台和地区。请求：GET /agent-inventory/price-options（前面拼接 baseUrl）。
     */
    agentPriceOptions(options?: ApiRequestOptions) { return request('/agent-inventory/price-options', dataResponseSchema(z.object({ services: z.array(z.string()), regions: z.array(z.string()) })), options); },
    /**
     * agentSettlementOrder = 查询结算交易详情。请求：GET /agent-inventory/transactions/${uuidSchema.parse(id)}${query(paginationQuerySchema.parse({ page, pageSize }))}（前面拼接 baseUrl）。
     */
    agentSettlementOrder(id: string, page = 1, pageSize = 50, options?: ApiRequestOptions) { return request(`/agent-inventory/transactions/${uuidSchema.parse(id)}${query(paginationQuerySchema.parse({ page, pageSize }))}`, dataResponseSchema(settlementOrderDetailSchema), options); },
    /**
     * agentPrices = 查询价格规则。请求：GET /agent-inventory/prices（前面拼接 baseUrl）。
     */
    agentPrices(options?: ApiRequestOptions) {
      return request('/agent-inventory/prices', dataResponseSchema(z.array(priceRuleSchema)), options);
    },
    /**
     * agentTransactions = 查询交易记录。请求：GET /agent-inventory/transactions${query(agentTransactionsQuerySchema.parse({ page, pageSize, ...filters }))}（前面拼接 baseUrl）。
     */
    agentTransactions(page: number, pageSize: number, options?: ApiRequestOptions, filters: Pick<z.input<typeof agentTransactionsQuerySchema>, 'status' | 'kind' | 'search'> = {}) {
      return request(`/agent-inventory/transactions${query(agentTransactionsQuerySchema.parse({ page, pageSize, ...filters }))}`, paginatedResponseSchema(txOrderSchema), options);
    },
    /**
     * agentLedger = 查询代理或客户的账本。请求：GET /agent-inventory/ledger/${ownerType}/${ownerId}${query({ page, pageSize, currency })}（前面拼接 baseUrl）。
     */
    agentLedger(owner: OwnerRef, page: number, pageSize: number, options?: ApiRequestOptions, currency = 'USD') {
      const [ownerType, ownerId] = owner.ownerType === 'AGENT' ? ['agent', owner.agentId] : ['customer', owner.customerId];
      return request(`/agent-inventory/ledger/${ownerType}/${ownerId}${query({ page, pageSize, currency })}`,
        z.object({
          data: z.object({
            currency: z.string(), balanceMinor: z.number(),
            entries: z.array(z.object({
              id: z.string().uuid(), type: z.string(), delta: z.number(), balanceAfter: z.number(),
              description: z.string(), txOrderId: z.string().uuid().nullable(), createdAt: z.string(),
            })),
          }),
          pagination: paginationSchema,
        }), options);
    },
    /**
     * ==================== 08 代理写操作 ====================
     * agentCreateAgent = 创建代理。请求：POST /agent-inventory/agents（前面拼接 baseUrl）。
     */
    agentCreateAgent(input: z.input<typeof createAgentInputSchema>) {
      return request('/agent-inventory/agents', dataResponseSchema(agentSchema), { method: 'POST', body: createAgentInputSchema.parse(input) });
    },
    /**
     * agentCreateCustomer = 创建客户。请求：POST /agent-inventory/customers（前面拼接 baseUrl）。
     */
    agentCreateCustomer(input: z.input<typeof createCustomerInputSchema>) {
      return request('/agent-inventory/customers', dataResponseSchema(customerSchema), { method: 'POST', body: createCustomerInputSchema.parse(input) });
    },
    /**
     * agentSavePrice = 保存价格规则。请求：POST /agent-inventory/prices（前面拼接 baseUrl）。
     */
    agentSavePrice(input: UpsertPriceRuleInput & { agentId?: string | null }) {
      return request('/agent-inventory/prices', dataResponseSchema(priceRuleSchema), { method: 'POST', body: upsertPriceRuleInputSchema.parse(input) });
    },
    /**
     * agentTransfer = 提交余额转账。请求：POST /agent-inventory/transfers（前面拼接 baseUrl）。
     */
    agentTransfer(input: TransferBalanceInput) {
      return request('/agent-inventory/transfers', dataResponseSchema(txOrderSchema), { method: 'POST', body: transferBalanceInputSchema.parse(input) });
    },
    /**
     * agentCreateHolding = 创建持有记录。请求：POST /agent-inventory/holdings（前面拼接 baseUrl）。
     */
    agentCreateHolding(input: z.input<typeof createHoldingInputSchema>) {
      return request('/agent-inventory/holdings', dataResponseSchema(numberHoldingSchema), { method: 'POST', body: createHoldingInputSchema.parse(input) });
    },
    /**
     * adminAdjustBalance = 管理员调整余额。请求：POST /agent-inventory/balance-adjustments（前面拼接 baseUrl）。
     */
    adminAdjustBalance(input: z.input<typeof adjustBalanceInputSchema>) {
      return request('/agent-inventory/balance-adjustments', dataResponseSchema(txOrderSchema), { method: 'POST', body: adjustBalanceInputSchema.parse(input) });
    },
    /**
     * ==================== 09 后台详情与管理写操作 ====================
     * adminUser = 查询用户详情及关联号码、订单。请求：GET /admin/users/${uuidSchema.parse(id)}（前面拼接 baseUrl）。
     */
    adminUser(id: string, options?: ApiRequestOptions) {
      return request(`/admin/users/${uuidSchema.parse(id)}`, dataResponseSchema(z.object({ user: adminUserSchema, numbers: z.array(adminNumberSchema), orders: z.array(adminOrderSchema) })), options);
    },
    /**
     * adminNumber = 查询号码详情和分配记录。请求：GET /admin/numbers/${uuidSchema.parse(id)}（前面拼接 baseUrl）。
     */
    adminNumber(id: string, options?: ApiRequestOptions) {
      return request(`/admin/numbers/${uuidSchema.parse(id)}`, dataResponseSchema(z.object({ number: adminNumberSchema, allocations: z.array(allocationSchema) })), options);
    },
    /**
     * adminOrder = 查询订单详情和分配记录。请求：GET /admin/orders/${uuidSchema.parse(id)}（前面拼接 baseUrl）。
     */
    adminOrder(id: string, options?: ApiRequestOptions) {
      return request(`/admin/orders/${uuidSchema.parse(id)}`, dataResponseSchema(z.object({ order: adminOrderSchema.extend({ product_snapshot: z.unknown() }), allocations: z.array(allocationSchema) })), options);
    },
    /**
     * adminResetPassword = 管理员重置用户密码。请求：POST /admin/users/${uuidSchema.parse(id)}/reset-password（前面拼接 baseUrl）。
     */
    adminResetPassword(id: string, input: AdminPasswordResetInput) {
      return request(`/admin/users/${uuidSchema.parse(id)}/reset-password`, dataResponseSchema(z.object({ changed: z.literal(true) })), { method: 'POST', body: adminPasswordResetInputSchema.parse(input) });
    },
    /**
     * adminUserStatus = 启用或停用用户。请求：PATCH /admin/users/${uuidSchema.parse(id)}/status（前面拼接 baseUrl）。
     */
    adminUserStatus(id: string, input: UserStatusInput) {
      return request(`/admin/users/${uuidSchema.parse(id)}/status`, dataResponseSchema(z.object({ changed: z.boolean() })), { method: 'PATCH', body: userStatusInputSchema.parse(input) });
    },
    /**
     * adminNumberAction = 改为 `days === '14' ? 14 : 60`，让提交值和选项一致。请求：POST /admin/numbers/${uuidSchema.parse(id)}/actions（前面拼接 baseUrl）。
     */
    adminNumberAction(id: string, input: NumberActionInput) {
      return request(`/admin/numbers/${uuidSchema.parse(id)}/actions`, dataResponseSchema(z.object({ changed: z.boolean() })), { method: 'POST', body: numberActionInputSchema.parse(input) });
    },
    /**
     * adminProductOptions = 查询上游有资源的商品组合。请求：GET /admin/product-options（前面拼接 baseUrl）。
     */
    adminProductOptions(options?: ApiRequestOptions) {
      return request('/admin/product-options', dataResponseSchema(z.array(productOptionSchema)), options);
    },
    /**
     * adminSyncProducts = 按上游组合补建缺少的商品草稿。请求：POST /admin/products/sync（前面拼接 baseUrl）。
     */
    adminSyncProducts(input: ProductSyncInput) {
      return request('/admin/products/sync', dataResponseSchema(productSyncResultSchema), { method: 'POST', body: productSyncInputSchema.parse(input) });
    },
    /**
     * adminSaveProduct = 新建或编辑商品。请求：POST（新建）或 PATCH（编辑） /admin/products（前面拼接 baseUrl）。create=true 用 POST 新建，否则用 PATCH 编辑。
     */
    adminSaveProduct(input: ProductInput, create: boolean) {
      return request('/admin/products', dataResponseSchema(z.object({ changed: z.boolean() })), { method: create ? 'POST' : 'PATCH', body: productInputSchema.parse(input) });
    },
    /**
     * ==================== 10 登录与密码找回 ====================
     * login = 登录并建立会话。请求：POST /auth/login（前面拼接 baseUrl）。
     */
    login(input: LoginInput, options?: ApiRequestOptions) {
      return request('/auth/login', dataResponseSchema(userSchema), { ...options, method: 'POST', body: loginInputSchema.parse(input) });
    },
    /**
     * register = 注册账号。请求：POST /auth/register（前面拼接 baseUrl）。
     */
    register(input: RegisterInput, options?: ApiRequestOptions) {
      return request('/auth/register', dataResponseSchema(userSchema), { ...options, method: 'POST', body: registerInputSchema.parse(input) });
    },
    /**
     * forgotPassword = 提交找回密码请求。请求：POST /auth/forgot-password（前面拼接 baseUrl）。
     */
    forgotPassword(input: ForgotPasswordInput) {
      return request('/auth/forgot-password', dataResponseSchema(z.object({ accepted: z.literal(true) })), { method: 'POST', body: forgotPasswordInputSchema.parse(input) });
    },
    /**
     * resetPassword = 使用重置凭据设置新密码。请求：POST /auth/reset-password（前面拼接 baseUrl）。
     */
    resetPassword(input: ResetPasswordInput) {
      return request('/auth/reset-password', dataResponseSchema(z.object({ changed: z.literal(true) })), { method: 'POST', body: resetPasswordInputSchema.parse(input) });
    },
    /**
     * me = 获取当前登录用户。请求：GET /auth/me（前面拼接 baseUrl）。
     */
    me(options?: ApiRequestOptions) { return request('/auth/me', dataResponseSchema(userSchema), options); },
    /**
     * logout = 退出登录。请求：POST /auth/logout（前面拼接 baseUrl）。
     */
    logout(options?: ApiRequestOptions) {
      return request('/auth/logout', dataResponseSchema(z.object({ loggedOut: z.literal(true) })), { ...options, method: 'POST', body: {} });
    },
    /**
     * ==================== 11 商城目录、号码与订单 ====================
     * catalog = 查询可购买的目录。请求：GET /catalog（前面拼接 baseUrl）。
     */
    catalog(options?: ApiRequestOptions) { return request('/catalog', dataResponseSchema(catalogSchema), options); },
    /**
     * dashboardOverview = 查询工作台概览。请求：GET /dashboard/overview（前面拼接 baseUrl）。
     */
    dashboardOverview(options?: ApiRequestOptions) { return request('/dashboard/overview', dataResponseSchema(dashboardSchema), options); },
    /**
     * dashboard = 查询工作台汇总。请求：GET /dashboard（前面拼接 baseUrl）。
     */
    dashboard(options?: ApiRequestOptions) { return request('/dashboard', dataResponseSchema(dashboardSchema), options); },
    /**
     * numbers = 查询当前用户的号码列表。请求：GET /numbers${query(numbersQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    numbers(input: z.input<typeof numbersQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/numbers${query(numbersQuerySchema.parse(input))}`, paginatedResponseSchema(numberSchema), options);
    },
    /**
     * renewalOptions = 查询号码续期选项。请求：GET /numbers/${uuidSchema.parse(id)}/renewal-options（前面拼接 baseUrl）。注意：后端 NumberServices 当前返回 RENEWAL_DISABLED；本方法存在不代表功能已开放。
     */
    renewalOptions(id: string, options?: ApiRequestOptions) {
      return request(`/numbers/${uuidSchema.parse(id)}/renewal-options`, dataResponseSchema(renewalOptionsSchema), options);
    },
    /**
     * renewals = 查询号码续期记录。请求：GET /numbers/${uuidSchema.parse(id)}/renewals${query(paginationQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    renewals(id: string, input: Partial<PaginationQuery> = {}, options?: ApiRequestOptions) {
      return request(`/numbers/${uuidSchema.parse(id)}/renewals${query(paginationQuerySchema.parse(input))}`, paginatedResponseSchema(renewalRecordSchema), options);
    },
    /**
     * createRenewal = 提交号码续期请求。请求：POST /numbers/${uuidSchema.parse(id)}/renewals（前面拼接 baseUrl）。注意：后端 NumberServices 当前返回 RENEWAL_DISABLED；本方法存在不代表功能已开放。
     */
    createRenewal(id: string, input: CreateRenewalInput, options?: ApiRequestOptions) {
      return request(`/numbers/${uuidSchema.parse(id)}/renewals`, dataResponseSchema(renewalRecordSchema), { ...options, method: 'POST', body: createRenewalInputSchema.parse(input) });
    },
    /**
     * numberUsage = 查询号码使用情况。请求：GET /numbers/${uuidSchema.parse(id)}/usage${query(usageQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    numberUsage(id: string, input: UsageQuery = {}, options?: ApiRequestOptions) {
      return request(`/numbers/${uuidSchema.parse(id)}/usage${query(usageQuerySchema.parse(input))}`, dataResponseSchema(numberUsageSchema), options);
    },
    /**
     * orders = 查询当前用户的订单列表。请求：GET /orders${query(listQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    orders(input: z.input<typeof listQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/orders${query(listQuerySchema.parse(input))}`, paginatedResponseSchema(orderSchema), options);
    },
    /**
     * order = 查询订单详情。请求：GET /orders/${uuidSchema.parse(id)}（前面拼接 baseUrl）。
     */
    order(id: string, options?: ApiRequestOptions) {
      return request(`/orders/${uuidSchema.parse(id)}`, dataResponseSchema(orderDetailSchema), options);
    },
    /**
     * createOrder = 提交购买订单。请求：POST /orders（前面拼接 baseUrl）。
     */
    createOrder(input: CreateOrderInput, options?: ApiRequestOptions) {
      return request('/orders', dataResponseSchema(orderDetailSchema), { ...options, method: 'POST', body: createOrderInputSchema.parse(input) });
    },
    /**
     * ==================== 12 短信、积分与账户 ====================
     * inbox = 查询短信收件箱。请求：GET /inbox${query(inboxQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    inbox(input: z.input<typeof inboxQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/inbox${query(inboxQuerySchema.parse(input))}`, paginatedResponseSchema(smsSchema), options);
    },
    /**
     * markRead = 将指定短信标记为已读。请求：POST /inbox/read（前面拼接 baseUrl）。
     */
    markRead(ids: string[], options?: ApiRequestOptions) {
      return request('/inbox/read', dataResponseSchema(z.object({ ids: z.array(uuidSchema), isRead: z.literal(true) })), {
        ...options, method: 'POST', body: markReadInputSchema.parse({ ids }),
      });
    },
    /**
     * points = 查询积分信息和记录。请求：GET /points${query(pointsQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    points(input: z.input<typeof pointsQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/points${query(pointsQuerySchema.parse(input))}`, pointsResponseSchema, options);
    },
    /**
     * account = 查询账户资料和相关状态。请求：GET /account（前面拼接 baseUrl）。
     */
    account(options?: ApiRequestOptions) { return request('/account', dataResponseSchema(accountSchema), options); },
    /**
     * rechargeOverview = 查询充值概览。请求：GET /account/recharge（前面拼接 baseUrl）。
     */
    rechargeOverview(options?: ApiRequestOptions) { return request('/account/recharge', dataResponseSchema(rechargeOverviewSchema), options); },
    /**
     * rechargeRecords = 查询充值记录。请求：GET /account/recharge/records${query(rechargeQuerySchema.parse(input))}（前面拼接 baseUrl）。
     */
    rechargeRecords(input: Partial<RechargeQuery> = {}, options?: ApiRequestOptions) {
      return request(`/account/recharge/records${query(rechargeQuerySchema.parse(input))}`, paginatedResponseSchema(rechargeRecordSchema), options);
    },
    /**
     * updateProfile = 修改账户资料。请求：PATCH /account/profile（前面拼接 baseUrl）。
     */
    updateProfile(input: AccountProfileInput, options?: ApiRequestOptions) {
      return request('/account/profile', dataResponseSchema(accountSchema), {
        ...options, method: 'PATCH', body: accountProfileInputSchema.parse(input),
      });
    },
    /**
     * preferences = 修改到期提醒偏好。请求：PATCH /account/preferences（前面拼接 baseUrl）。
     */
    preferences(expiryNotice: boolean, options?: ApiRequestOptions) {
      return request('/account/preferences', dataResponseSchema(preferencesSchema), {
        ...options, method: 'PATCH', body: preferencesInputSchema.parse({ expiryNotice }),
      });
    },
  };
}
/**
 * ==================== 13 导出接口工具类型 ====================
 * LinepoolApi = 接口工具的数据类型。让编辑器知道 api 有哪些方法、每个方法应该传什么。
 */
export type LinepoolApi = ReturnType<typeof createLinepoolApi>;
