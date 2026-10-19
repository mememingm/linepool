import { z } from 'zod';
import { adminQuerySchema, adminSummarySchema, adminUserSchema, adminNumberSchema, adminOrderSchema,
  allocationSchema, productInputSchema, numberActionInputSchema, userStatusInputSchema,
  type AdminQuery, type NumberActionInput, type ProductInput, type UserStatusInput } from '@linepool/contracts/admin';
import {
  accountProfileInputSchema, accountSchema, apiErrorSchema, catalogSchema, createOrderInputSchema, dashboardSchema,
  dataResponseSchema, inboxQuerySchema, listQuerySchema, loginInputSchema, markReadInputSchema,
  numberSchema, numbersQuerySchema, orderDetailSchema, orderSchema, paginatedResponseSchema,
  pointsQuerySchema, pointsResponseSchema, preferencesInputSchema, preferencesSchema,
  registerInputSchema, smsSchema, userSchema, uuidSchema,
  createRenewalInputSchema, renewalOptionsSchema, renewalRecordSchema, numberUsageSchema, usageQuerySchema, paginationQuerySchema,
  type CreateRenewalInput, type UsageQuery, type PaginationQuery,
  type AccountProfileInput, type CreateOrderInput, type LoginInput, type RegisterInput,
} from './contracts';

export class LinepoolApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'LinepoolApiError';
  }
}
export type ApiRequestOptions = { signal?: AbortSignal };
export type ApiClientConfiguration = { baseUrl?: string; timeoutMs?: number };
export function createLinepoolApi(configuration: ApiClientConfiguration = {}) {
  const baseUrl = (configuration.baseUrl ?? import.meta.env.VITE_LINEPOOL_API_URL ?? '/api').replace(/\/$/, '');
  const timeoutMs = configuration.timeoutMs ?? 15000;
  async function request<T extends z.ZodType>(
    path: string, schema: T, options: ApiRequestOptions & { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
  ): Promise<z.infer<T>> {
    const controller = new AbortController();
    const relayAbort = () => controller.abort(options.signal?.reason);
    const timeout = setTimeout(() => controller.abort(new DOMException('Request timeout', 'TimeoutError')), timeoutMs);
    if (options.signal?.aborted) relayAbort();
    options.signal?.addEventListener('abort', relayAbort, { once: true });
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET', credentials: 'include', signal: controller.signal,
        cache: 'no-store',
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
    sandboxStatus(options?: ApiRequestOptions) { return request('/sandbox', dataResponseSchema(z.object({enabled:z.boolean()})), options); },
    sandboxCredit() { return request('/sandbox/credit', dataResponseSchema(z.object({status:z.string()})), {method:'POST',body:{}}); },
    sandboxFulfill(orderId:string,outcome:'SUCCESS'|'FAILED'|'UNKNOWN') { return request('/sandbox/fulfill',dataResponseSchema(z.object({status:z.string()})),{method:'POST',body:{orderId,outcome}}); },
    sandboxInbound(input:{id:string;numberId:string;outcome:'SUCCESS'|'FAILED'|'UNKNOWN';resolve?:boolean}) { return request('/sandbox/inbound',dataResponseSchema(z.object({status:z.string()})),{method:'POST',body:input}); },
    adminSession(options?: ApiRequestOptions) { return request('/admin/session', dataResponseSchema(userSchema), options); },
    adminSummary(options?: ApiRequestOptions) { return request('/admin/summary', dataResponseSchema(adminSummarySchema), options); },
    adminList<T extends z.ZodType>(section: string, schema: T, input: Partial<AdminQuery>, options?: ApiRequestOptions) {
      return request(`/admin/${section}${query(adminQuerySchema.parse(input))}`, paginatedResponseSchema(schema), options);
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
    adminUserStatus(id: string, input: UserStatusInput) {
      return request(`/admin/users/${uuidSchema.parse(id)}/status`, dataResponseSchema(z.object({ changed: z.boolean() })), { method: 'PATCH', body: userStatusInputSchema.parse(input) });
    },
    adminNumberAction(id: string, input: NumberActionInput) {
      return request(`/admin/numbers/${uuidSchema.parse(id)}/actions`, dataResponseSchema(z.object({ changed: z.boolean() })), { method: 'POST', body: numberActionInputSchema.parse(input) });
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
    me(options?: ApiRequestOptions) { return request('/auth/me', dataResponseSchema(userSchema), options); },
    logout(options?: ApiRequestOptions) {
      return request('/auth/logout', dataResponseSchema(z.object({ loggedOut: z.literal(true) })), { ...options, method: 'POST', body: {} });
    },
    catalog(options?: ApiRequestOptions) { return request('/catalog', dataResponseSchema(catalogSchema), options); },
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
    markRead(ids: string[], options?: ApiRequestOptions) {
      return request('/inbox/read', dataResponseSchema(z.object({ ids: z.array(uuidSchema), isRead: z.literal(true) })), {
        ...options, method: 'POST', body: markReadInputSchema.parse({ ids }),
      });
    },
    points(input: z.input<typeof pointsQuerySchema> = {}, options?: ApiRequestOptions) {
      return request(`/points${query(pointsQuerySchema.parse(input))}`, pointsResponseSchema, options);
    },
    account(options?: ApiRequestOptions) { return request('/account', dataResponseSchema(accountSchema), options); },
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
