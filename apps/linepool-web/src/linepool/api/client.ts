import { z } from 'zod';
import { adminQuerySchema, adminOrdersQuerySchema, adminSummarySchema, adminUserSchema, adminNumberSchema, adminOrderSchema,
  adminPasswordResetInputSchema, type AdminPasswordResetInput,
  allocationSchema, productInputSchema, numberActionInputSchema, userStatusInputSchema,
  adminUpstreamStatusSchema, adminWebhookRetryInputSchema, adminWebhookRetryResultSchema,
  productOptionSchema, productSyncInputSchema, productSyncResultSchema, type ProductSyncInput,
  adminPlatformSchema, platformInputSchema, type PlatformInput, adminShopsSchema, officialShopInputSchema, type OfficialShopInput,
  agentShopSchema, shopProductInputSchema, adminShopProductSchema, shopProductHoldInputSchema, type ShopProductInput, type ShopProductHoldInput,
  adminShopDeliveryQuerySchema, adminShopDeliveryPageSchema, type AdminShopDeliveryQuery,
  type AdminQuery, type NumberActionInput, type ProductInput, type UserStatusInput } from '@linepool/contracts/admin';
import {
  accountProfileInputSchema, accountSchema, apiErrorSchema, catalogSchema, createOrderInputSchema, dashboardSchema,
  dataResponseSchema, inboxQuerySchema, inboxWaitInputSchema, inboxWaitSchema, listQuerySchema, loginInputSchema, markReadInputSchema,
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
} from './contracts';
import {
  pcAuthStartInputSchema, pcAuthStartSchema, pcConnectionSchema, pcConnectionInputSchema,
  pcSessionSchema, pcMessageSchema, pcMessagesQuerySchema, pcReadInputSchema, pcWaitInputSchema,
  pcWaitSchema, pcPlanInputSchema, pcPlanSchema, type PcAuthStartInput, type PcCapability, type PcPlanInput,
} from './contracts';
import {
  serviceSchema, platformCodeRuleInputSchema, platformCodeRuleSchema,
  receivingReviewInputSchema, receivingReviewViewSchema, receivingReviewResultSchema,
  type PlatformCodeRuleInput, type ReceivingReviewInput,
} from './contracts';

export class LinepoolApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'LinepoolApiError';
  }
}
export type ApiRequestOptions = { signal?: AbortSignal; keepalive?: boolean };
export type ApiClientConfiguration = { baseUrl?: string; timeoutMs?: number };
export function createLinepoolApi(configuration: ApiClientConfiguration = {}) {
  const baseUrl = (configuration.baseUrl ?? import.meta.env.VITE_LINEPOOL_API_URL ?? '/api').replace(/\/$/, '');
  const timeoutMs = configuration.timeoutMs ?? 15000;
  async function request<T extends z.ZodType>(
    path: string, schema: T, options: ApiRequestOptions & { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; timeoutMs?: number } = {},
  ): Promise<z.infer<T>> {
    const controller = new AbortController();
    const relayAbort = () => controller.abort(options.signal?.reason);
    const timeout = setTimeout(() => controller.abort(new DOMException('Request timeout', 'TimeoutError')), options.timeoutMs ?? timeoutMs);
    if (options.signal?.aborted) relayAbort();
    options.signal?.addEventListener('abort', relayAbort, { once: true });
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET', credentials: 'include', signal: controller.signal,
        cache: 'no-store', keepalive: options.keepalive,
        headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(payload);
        const error = parsed.success ? parsed.data.error : { code: 'HTTP_ERROR', message: `HTTP ${response.status}` };
        throw new LinepoolApiError(response.status, error.code, error.message, 'details' in error ? error.details : undefined);
      }
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
  const query = (values: Record<string, unknown>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
    return `?${params.toString()}`;
  };
  return {
    pcSession(options?: ApiRequestOptions) { return request('/pc/session', dataResponseSchema(pcSessionSchema), options); },
    pcAuthStart(input: PcAuthStartInput) {
      return request('/pc/auth/start', dataResponseSchema(pcAuthStartSchema), { method: 'POST', body: pcAuthStartInputSchema.parse(input) });
    },
    pcConnection(enabledCapabilities: PcCapability[]) {
      return request('/pc/connection', dataResponseSchema(pcConnectionSchema), { method: 'PATCH', body: pcConnectionInputSchema.parse({ enabledCapabilities }) });
    },
    pcMessages(input: z.input<typeof pcMessagesQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/pc/messages${query(pcMessagesQuerySchema.parse(input))}`, paginatedResponseSchema(pcMessageSchema), options);
    },
    pcRead(ids: string[]) {
      return request('/pc/messages/read', dataResponseSchema(z.object({ changed: z.number().int().nonnegative() })), { method: 'POST', body: pcReadInputSchema.parse({ ids }) });
    },
    pcWait(input: z.input<typeof pcWaitInputSchema>, options?: ApiRequestOptions) {
      return request('/pc/wait', dataResponseSchema(pcWaitSchema), { ...options, method: 'POST', body: pcWaitInputSchema.parse(input) });
    },
    pcSavePlan(input: PcPlanInput, id?: string) {
      return request(`/pc/plans${id ? `/${uuidSchema.parse(id)}` : ''}`, dataResponseSchema(pcPlanSchema), { method: id ? 'PATCH' : 'POST', body: pcPlanInputSchema.parse(input) });
    },
    pcArchivePlan(id: string) {
      return request(`/pc/plans/${uuidSchema.parse(id)}`, dataResponseSchema(z.object({ changed: z.boolean() })), { method: 'DELETE' });
    },
    adminPcConnections(options?: ApiRequestOptions) { return request('/admin/pc/connections', dataResponseSchema(z.array(pcConnectionSchema)), options); },
    adminPcPoll(id: string) {
      return request(`/admin/pc/connections/${uuidSchema.parse(id)}/poll`, dataResponseSchema(z.object({ requested: z.boolean() })), { method: 'POST', body: {} });
    },
    sandboxStatus(options?: ApiRequestOptions) { return request('/sandbox', dataResponseSchema(z.object({enabled:z.boolean()})), options); },
    sandboxCredit() { return request('/sandbox/credit', dataResponseSchema(z.object({status:z.string()})), {method:'POST',body:{}}); },
    sandboxFulfill(orderId:string,outcome:'SUCCESS'|'FAILED'|'UNKNOWN') { return request('/sandbox/fulfill',dataResponseSchema(z.object({status:z.string()})),{method:'POST',body:{orderId,outcome}}); },
    sandboxInbound(input:{id:string;numberId:string;allocationId?:string;outcome:'SUCCESS'|'FAILED'|'UNKNOWN';resolve?:boolean}) { return request('/sandbox/inbound',dataResponseSchema(z.object({status:z.string()})),{method:'POST',body:input}); },
    adminSession(options?: ApiRequestOptions) { return request('/admin/session', dataResponseSchema(userSchema), options); },
    adminSummary(options?: ApiRequestOptions) { return request('/admin/summary', dataResponseSchema(adminSummarySchema), options); },
    adminUpstreamStatus(options?: ApiRequestOptions) {
      return request('/admin/integrations/pingcode', dataResponseSchema(adminUpstreamStatusSchema), options);
    },
    adminRetryWebhook(input: z.input<typeof adminWebhookRetryInputSchema>) {
      return request('/admin/integrations/pingcode/retry', dataResponseSchema(adminWebhookRetryResultSchema), {
        method: 'POST', body: adminWebhookRetryInputSchema.parse(input),
      });
    },
    adminPlatforms(options?: ApiRequestOptions) {
      return request('/admin/platforms', dataResponseSchema(z.array(adminPlatformSchema)), options);
    },
    adminSavePlatform(input: PlatformInput, create: boolean) {
      return request('/admin/platforms', dataResponseSchema(z.object({ changed: z.boolean() })), { method: create ? 'POST' : 'PATCH', body: platformInputSchema.parse(input) });
    },
    pcShop(options?: ApiRequestOptions) { return request('/pc/shop', dataResponseSchema(agentShopSchema), options); },
    pcSaveShopProduct(input: ShopProductInput, id?: string) {
      return request(`/pc/shop/products${id ? `/${uuidSchema.parse(id)}` : ''}`, dataResponseSchema(z.object({ id: uuidSchema })), { method: id ? 'PATCH' : 'POST', body: shopProductInputSchema.parse(input) });
    },
    adminShopProducts(options?: ApiRequestOptions) { return request('/admin/shop-products', dataResponseSchema(z.array(adminShopProductSchema)), options); },
    adminShopDeliveries(input: Partial<AdminShopDeliveryQuery> = {}, options?: ApiRequestOptions) {
      return request(`/admin/shop-deliveries${query(adminShopDeliveryQuerySchema.parse(input))}`, adminShopDeliveryPageSchema, options);
    },
    adminHoldShopProduct(id: string, input: ShopProductHoldInput) {
      return request(`/admin/shop-products/${uuidSchema.parse(id)}/hold`, dataResponseSchema(z.object({ changed: z.boolean() })), { method: 'POST', body: shopProductHoldInputSchema.parse(input) });
    },
    adminShops(options?: ApiRequestOptions) { return request('/admin/shops', dataResponseSchema(adminShopsSchema), options); },
    adminSetOfficialShop(input: OfficialShopInput) {
      return request('/admin/shops/official', dataResponseSchema(z.object({ changed: z.boolean() })), { method: 'POST', body: officialShopInputSchema.parse(input) });
    },
    adminPlatformCodeRule(platformId: string, options?: ApiRequestOptions) {
      return request(`/admin/platforms/${encodeURIComponent(serviceSchema.parse(platformId))}/code-rule`, dataResponseSchema(platformCodeRuleSchema.nullable()), options);
    },
    adminSavePlatformCodeRule(platformId: string, input: PlatformCodeRuleInput) {
      return request(`/admin/platforms/${encodeURIComponent(serviceSchema.parse(platformId))}/code-rule`, dataResponseSchema(platformCodeRuleSchema), { method: 'PUT', body: platformCodeRuleInputSchema.parse(input) });
    },
    adminReceivingReview(allocationId: string, options?: ApiRequestOptions) {
      return request(`/admin/allocations/${uuidSchema.parse(allocationId)}/receiving-review`, dataResponseSchema(receivingReviewViewSchema), options);
    },
    adminConfirmReceivingReview(allocationId: string, input: ReceivingReviewInput) {
      return request(`/admin/allocations/${uuidSchema.parse(allocationId)}/receiving-review`, dataResponseSchema(receivingReviewResultSchema), { method: 'POST', body: receivingReviewInputSchema.parse(input) });
    },
    adminRechargeSettings(options?: ApiRequestOptions) { return request('/admin/recharge-settings', dataResponseSchema(rechargeSettingsSchema), options); },
    adminSaveRechargeSettings(input: RechargeSettingsInput) {
      return request('/admin/recharge-settings', dataResponseSchema(rechargeSettingsSchema), { method: 'PATCH', body: rechargeSettingsInputSchema.parse(input) });
    },
    adminList<T extends z.ZodType>(section: string, schema: T, input: Partial<AdminQuery>, options?: ApiRequestOptions) {
      return request(`/admin/${section}${query((section === 'orders' ? adminOrdersQuerySchema : adminQuerySchema).parse(input))}`, paginatedResponseSchema(schema), options);
    },
    agentContext(options?: ApiRequestOptions) {
      return request('/agent-inventory/context', dataResponseSchema(agentContextSchema), options);
    },
    agentUpdateProfile(input: z.input<typeof updateAgentNameInputSchema>) {
      return request('/agent-inventory/profile', dataResponseSchema(agentSchema), { method: 'PATCH', body: updateAgentNameInputSchema.parse(input) });
    },
    agentUpdateCustomer(id: string, input: z.input<typeof updateCustomerInputSchema>) {
      return request(`/agent-inventory/customers/${uuidSchema.parse(id)}`, dataResponseSchema(customerSchema), { method: 'PATCH', body: updateCustomerInputSchema.parse(input) });
    },
    agentPlatformSettlement(period: z.input<typeof agentMetricPeriodSchema> = '7d', options?: ApiRequestOptions) {
      return request(`/agent-inventory/platform-settlement${query({ period: agentMetricPeriodSchema.parse(period) })}`, dataResponseSchema(platformSettlementSchema), options);
    },
    agentDashboard(period: z.input<typeof agentMetricPeriodSchema> = '7d', options?: ApiRequestOptions) {
      return request(`/agent-inventory/dashboard${query({ period: agentMetricPeriodSchema.parse(period) })}`, dataResponseSchema(agentDashboardSchema), options);
    },
    agentSubagents(input: z.input<typeof subagentsQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/subagents${query(subagentsQuerySchema.parse(input))}`, paginatedResponseSchema(subagentSchema), options);
    },
    agentSubagent(id: string, options?: ApiRequestOptions) {
      return request(`/agent-inventory/subagents/${uuidSchema.parse(id)}`, dataResponseSchema(subagentSchema), options);
    },
    agentCreateSubagent(input: z.input<typeof createSubagentInputSchema>) {
      return request('/agent-inventory/subagents', dataResponseSchema(subagentSchema), { method: 'POST', body: createSubagentInputSchema.parse(input) });
    },
    agentRenameSubagent(id: string, input: z.input<typeof updateAgentNameInputSchema>) {
      return request(`/agent-inventory/subagents/${uuidSchema.parse(id)}/name`, dataResponseSchema(subagentSchema), { method: 'PATCH', body: updateAgentNameInputSchema.parse(input) });
    },
    agentSubagentStatus(id: string, input: z.input<typeof subagentStatusInputSchema>) {
      return request(`/agent-inventory/subagents/${uuidSchema.parse(id)}/status`, dataResponseSchema(z.object({ changed: z.boolean(), agentId: uuidSchema, status: z.string() })), { method: 'PATCH', body: subagentStatusInputSchema.parse(input) });
    },
    agentSubagentHoldings(id: string, input: z.input<typeof paginationQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/subagents/${uuidSchema.parse(id)}/holdings${query(paginationQuerySchema.parse(input))}`, paginatedResponseSchema(holdingTransferSchema), options);
    },
    agentSubagentTransactions(id: string, input: z.input<typeof paginationQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/subagents/${uuidSchema.parse(id)}/transactions${query(paginationQuerySchema.parse(input))}`, paginatedResponseSchema(txOrderSchema), options);
    },
    agentTransferableHoldings(input: z.input<typeof agentInventoryQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/transferable-holdings${query(agentInventoryQuerySchema.parse(input))}`, dataResponseSchema(z.array(transferableHoldingSchema)), options);
    },
    agentAgents(options?: ApiRequestOptions) {
      return request('/agent-inventory/agents', dataResponseSchema(z.array(agentSchema)), options);
    },
    agentCustomers(options?: ApiRequestOptions) {
      return request('/agent-inventory/customers', dataResponseSchema(z.array(customerSchema)), options);
    },
    agentCustomerHoldings(customerId: string, input: z.input<typeof paginationQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/customers/${uuidSchema.parse(customerId)}/holdings${query(paginationQuerySchema.parse(input))}`, paginatedResponseSchema(numberHoldingSchema), options);
    },
    agentHoldings(input: z.input<typeof agentInventoryQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/holdings${query(agentInventoryQuerySchema.parse(input))}`, paginatedResponseSchema(numberHoldingSchema), options);
    },
    agentStock(input: z.input<typeof agentStockQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/agent-inventory/stock${query(agentStockQuerySchema.parse(input))}`, paginatedResponseSchema(agentNumberStockSchema).extend({ counts: agentStockCountsSchema }), options);
    },
    agentImportStock(input: z.input<typeof agentNumberImportInputSchema>) {
      return request('/agent-inventory/stock/import', dataResponseSchema(z.object({ idempotencyKey: uuidSchema, importedCount: z.number().int().nonnegative(), replayed: z.boolean(), items: z.array(agentNumberStockSchema) })), { method: 'POST', body: agentNumberImportInputSchema.parse(input) });
    },
    agentClaimStock(input: z.input<typeof claimAgentNumberInputSchema>) {
      return request('/agent-inventory/stock/claim', dataResponseSchema(z.object({ holding: numberHoldingSchema, stock: agentNumberStockSchema, replayed: z.boolean() })), { method: 'POST', body: claimAgentNumberInputSchema.parse(input) });
    },
    agentClaimStockBatch(input: z.input<typeof claimAgentNumbersInputSchema>) {
      return request('/agent-inventory/stock/claim-batch', dataResponseSchema(z.object({ holdings: z.array(numberHoldingSchema), stocks: z.array(agentNumberStockSchema), replayed: z.boolean() })), { method: 'POST', body: claimAgentNumbersInputSchema.parse(input) });
    },
    agentReleaseHolding(id: string, input: z.input<typeof releaseHoldingInputSchema>) {
      return request(`/agent-inventory/holdings/${uuidSchema.parse(id)}/release`, dataResponseSchema(z.object({ stock: agentNumberStockSchema, releasedHoldingId: uuidSchema })), { method: 'POST', body: releaseHoldingInputSchema.parse(input) });
    },
    agentHoldingBatchPreview(input: z.input<typeof holdingBatchPreviewInputSchema>) {
      return request('/agent-inventory/holdings/batch-preview', dataResponseSchema(holdingBatchPreviewSchema), { method: 'POST', body: holdingBatchPreviewInputSchema.parse(input), timeoutMs: 120000 });
    },
    agentTransferHoldingBatch(input: z.input<typeof holdingBatchInputSchema>) {
      return request('/agent-inventory/holdings/batch-transfer', dataResponseSchema(holdingBatchResultSchema), { method: 'POST', body: holdingBatchInputSchema.parse(input), timeoutMs: 120000 });
    },
    agentAssignHoldingToCustomer(input: z.input<typeof assignHoldingInputSchema>) {
      return request('/agent-inventory/holdings/assign-customer', dataResponseSchema(z.object({ holding: numberHoldingSchema, orderId: uuidSchema, replayed: z.boolean() })), { method: 'POST', body: assignHoldingInputSchema.parse(input) });
    },
    agentResellHolding(input: z.input<typeof resellHoldingInputSchema>) {
      return request('/agent-inventory/holdings/resell', dataResponseSchema(z.object({ holding: numberHoldingSchema, orderId: uuidSchema, replayed: z.boolean() })), { method: 'POST', body: resellHoldingInputSchema.parse(input) });
    },
    agentBalances(options?: ApiRequestOptions) {
      return request('/agent-inventory/balances', dataResponseSchema(z.array(balanceAccountSchema)), options);
    },
    agentSettlementPreview(input: z.input<typeof settlementQuoteInputSchema>, options?: ApiRequestOptions) {
      return request('/agent-inventory/settlement-preview', dataResponseSchema(settlementQuoteSchema), { ...options, method: 'POST', body: settlementQuoteInputSchema.parse(input) });
    },
    agentPriceOptions(options?: ApiRequestOptions) { return request('/agent-inventory/price-options', dataResponseSchema(z.object({ services: z.array(z.string()), regions: z.array(z.string()) })), options); },
    agentSettlementOrder(id: string, page = 1, pageSize = 50, options?: ApiRequestOptions) { return request(`/agent-inventory/transactions/${uuidSchema.parse(id)}${query(paginationQuerySchema.parse({ page, pageSize }))}`, dataResponseSchema(settlementOrderDetailSchema), options); },
    agentPrices(options?: ApiRequestOptions) {
      return request('/agent-inventory/prices', dataResponseSchema(z.array(priceRuleSchema)), options);
    },
    agentTransactions(page: number, pageSize: number, options?: ApiRequestOptions, filters: Pick<z.input<typeof agentTransactionsQuerySchema>, 'status' | 'kind' | 'search'> = {}) {
      return request(`/agent-inventory/transactions${query(agentTransactionsQuerySchema.parse({ page, pageSize, ...filters }))}`, paginatedResponseSchema(txOrderSchema), options);
    },
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
    agentCreateAgent(input: z.input<typeof createAgentInputSchema>) {
      return request('/agent-inventory/agents', dataResponseSchema(agentSchema), { method: 'POST', body: createAgentInputSchema.parse(input) });
    },
    agentCreateCustomer(input: z.input<typeof createCustomerInputSchema>) {
      return request('/agent-inventory/customers', dataResponseSchema(customerSchema), { method: 'POST', body: createCustomerInputSchema.parse(input) });
    },
    agentSavePrice(input: UpsertPriceRuleInput & { agentId?: string | null }) {
      return request('/agent-inventory/prices', dataResponseSchema(priceRuleSchema), { method: 'POST', body: upsertPriceRuleInputSchema.parse(input) });
    },
    agentTransfer(input: TransferBalanceInput) {
      return request('/agent-inventory/transfers', dataResponseSchema(txOrderSchema), { method: 'POST', body: transferBalanceInputSchema.parse(input) });
    },
    agentCreateHolding(input: z.input<typeof createHoldingInputSchema>) {
      return request('/agent-inventory/holdings', dataResponseSchema(numberHoldingSchema), { method: 'POST', body: createHoldingInputSchema.parse(input) });
    },
    adminAdjustBalance(input: z.input<typeof adjustBalanceInputSchema>) {
      return request('/agent-inventory/balance-adjustments', dataResponseSchema(txOrderSchema), { method: 'POST', body: adjustBalanceInputSchema.parse(input) });
    },
    adminUser(id: string, options?: ApiRequestOptions) {
      return request(`/admin/users/${uuidSchema.parse(id)}`, dataResponseSchema(z.object({ user: adminUserSchema, numbers: z.array(adminNumberSchema), orders: z.array(adminOrderSchema) })), options);
    },
    adminNumber(id: string, options?: ApiRequestOptions) {
      return request(`/admin/numbers/${uuidSchema.parse(id)}`, dataResponseSchema(z.object({ number: adminNumberSchema, allocations: z.array(allocationSchema) })), options);
    },
    adminOrder(id: string, options?: ApiRequestOptions) {
      return request(`/admin/orders/${uuidSchema.parse(id)}`, dataResponseSchema(z.object({ order: adminOrderSchema.extend({ product_snapshot: z.unknown() }), allocations: z.array(allocationSchema) })), options);
    },
    adminResetPassword(id: string, input: AdminPasswordResetInput) {
      return request(`/admin/users/${uuidSchema.parse(id)}/reset-password`, dataResponseSchema(z.object({ changed: z.literal(true) })), { method: 'POST', body: adminPasswordResetInputSchema.parse(input) });
    },
    adminUserStatus(id: string, input: UserStatusInput) {
      return request(`/admin/users/${uuidSchema.parse(id)}/status`, dataResponseSchema(z.object({ changed: z.boolean() })), { method: 'PATCH', body: userStatusInputSchema.parse(input) });
    },
    adminNumberAction(id: string, input: NumberActionInput) {
      return request(`/admin/numbers/${uuidSchema.parse(id)}/actions`, dataResponseSchema(z.object({ changed: z.boolean() })), { method: 'POST', body: numberActionInputSchema.parse(input) });
    },
    adminProductOptions(options?: ApiRequestOptions) {
      return request('/admin/product-options', dataResponseSchema(z.array(productOptionSchema)), options);
    },
    adminSyncProducts(input: ProductSyncInput) {
      return request('/admin/products/sync', dataResponseSchema(productSyncResultSchema), { method: 'POST', body: productSyncInputSchema.parse(input) });
    },
    adminSaveProduct(input: ProductInput, create: boolean) {
      return request('/admin/products', dataResponseSchema(z.object({ changed: z.boolean() })), { method: create ? 'POST' : 'PATCH', body: productInputSchema.parse(input) });
    },
    login(input: LoginInput, options?: ApiRequestOptions) {
      return request('/auth/login', dataResponseSchema(userSchema), { ...options, method: 'POST', body: loginInputSchema.parse(input) });
    },
    register(input: RegisterInput, options?: ApiRequestOptions) {
      return request('/auth/register', dataResponseSchema(userSchema), { ...options, method: 'POST', body: registerInputSchema.parse(input) });
    },
    forgotPassword(input: ForgotPasswordInput) {
      return request('/auth/forgot-password', dataResponseSchema(z.object({ accepted: z.literal(true) })), { method: 'POST', body: forgotPasswordInputSchema.parse(input) });
    },
    resetPassword(input: ResetPasswordInput) {
      return request('/auth/reset-password', dataResponseSchema(z.object({ changed: z.literal(true) })), { method: 'POST', body: resetPasswordInputSchema.parse(input) });
    },
    me(options?: ApiRequestOptions) { return request('/auth/me', dataResponseSchema(userSchema), options); },
    logout(options?: ApiRequestOptions) {
      return request('/auth/logout', dataResponseSchema(z.object({ loggedOut: z.literal(true) })), { ...options, method: 'POST', body: {} });
    },
    catalog(options?: ApiRequestOptions) { return request('/catalog', dataResponseSchema(catalogSchema), options); },
    dashboardOverview(options?: ApiRequestOptions) { return request('/dashboard/overview', dataResponseSchema(dashboardSchema), options); },
    dashboard(options?: ApiRequestOptions) { return request('/dashboard', dataResponseSchema(dashboardSchema), options); },
    numbers(input: z.input<typeof numbersQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/numbers${query(numbersQuerySchema.parse(input))}`, paginatedResponseSchema(numberSchema), options);
    },
    renewalOptions(id: string, options?: ApiRequestOptions) {
      return request(`/numbers/${uuidSchema.parse(id)}/renewal-options`, dataResponseSchema(renewalOptionsSchema), options);
    },
    renewals(id: string, input: Partial<PaginationQuery> = {}, options?: ApiRequestOptions) {
      return request(`/numbers/${uuidSchema.parse(id)}/renewals${query(paginationQuerySchema.parse(input))}`, paginatedResponseSchema(renewalRecordSchema), options);
    },
    createRenewal(id: string, input: CreateRenewalInput, options?: ApiRequestOptions) {
      return request(`/numbers/${uuidSchema.parse(id)}/renewals`, dataResponseSchema(renewalRecordSchema), { ...options, method: 'POST', body: createRenewalInputSchema.parse(input) });
    },
    numberUsage(id: string, input: UsageQuery = {}, options?: ApiRequestOptions) {
      return request(`/numbers/${uuidSchema.parse(id)}/usage${query(usageQuerySchema.parse(input))}`, dataResponseSchema(numberUsageSchema), options);
    },
    orders(input: z.input<typeof listQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/orders${query(listQuerySchema.parse(input))}`, paginatedResponseSchema(orderSchema), options);
    },
    order(id: string, options?: ApiRequestOptions) {
      return request(`/orders/${uuidSchema.parse(id)}`, dataResponseSchema(orderDetailSchema), options);
    },
    createOrder(input: CreateOrderInput, options?: ApiRequestOptions) {
      return request('/orders', dataResponseSchema(orderDetailSchema), { ...options, method: 'POST', body: createOrderInputSchema.parse(input) });
    },
    inbox(input: z.input<typeof inboxQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/inbox${query(inboxQuerySchema.parse(input))}`, paginatedResponseSchema(smsSchema), options);
    },
    inboxWait(input: z.input<typeof inboxWaitInputSchema>, options?: ApiRequestOptions) {
      return request('/inbox/wait', dataResponseSchema(inboxWaitSchema), { ...options, method: 'POST', body: inboxWaitInputSchema.parse(input) });
    },
    markRead(ids: string[], options?: ApiRequestOptions) {
      return request('/inbox/read', dataResponseSchema(z.object({ ids: z.array(uuidSchema), isRead: z.literal(true) })), {
        ...options, method: 'POST', body: markReadInputSchema.parse({ ids }),
      });
    },
    points(input: z.input<typeof pointsQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/points${query(pointsQuerySchema.parse(input))}`, pointsResponseSchema, options);
    },
    account(options?: ApiRequestOptions) { return request('/account', dataResponseSchema(accountSchema), options); },
    rechargeOverview(options?: ApiRequestOptions) { return request('/account/recharge', dataResponseSchema(rechargeOverviewSchema), options); },
    rechargeRecords(input: Partial<RechargeQuery> = {}, options?: ApiRequestOptions) {
      return request(`/account/recharge/records${query(rechargeQuerySchema.parse(input))}`, paginatedResponseSchema(rechargeRecordSchema), options);
    },
    updateProfile(input: AccountProfileInput, options?: ApiRequestOptions) {
      return request('/account/profile', dataResponseSchema(accountSchema), {
        ...options, method: 'PATCH', body: accountProfileInputSchema.parse(input),
      });
    },
    preferences(expiryNotice: boolean, options?: ApiRequestOptions) {
      return request('/account/preferences', dataResponseSchema(preferencesSchema), {
        ...options, method: 'PATCH', body: preferencesInputSchema.parse({ expiryNotice }),
      });
    },
  };
}
export type LinepoolApi = ReturnType<typeof createLinepoolApi>;
