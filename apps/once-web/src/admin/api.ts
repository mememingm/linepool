import { queryOptions, keepPreviousData } from "@tanstack/react-query";
import { ApiError, request } from "../lib/api";
import type { IntegrationCheck, IntegrationConfig, IntegrationInput, IntegrationSync, UpstreamNumber } from './integrations';
import type { RequestOptions } from "../lib/models";
import type {
  AdminAudit, AdminLease, AdminMessage, AdminNumber, AdminOrder, AdminQuery, AdminSession,
  AdminPlan, AdminSettings, AdminSummary, AdminUser, AdminWebhook, BatchResult, ImportPreview, LeaseDetail, NumberDetail,
  NumberInput, Page, PlanInput, RegionStock, UserDetail,
} from "./types";

// `npm run dev:admin-mock` serves fixtures so the admin UI works before /api/admin exists.
// The flag is replaced at build time, so production bundles never include the mock module.
export const adminMock = import.meta.env.VITE_ADMIN_MOCK === "true";

async function adminRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (adminMock) {
    const { mockAdminRequest } = await import("./mock");
    return mockAdminRequest(path, options) as Promise<T>;
  }
  return request<T>(`/admin${path}`, options);
}
function query(input: AdminQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (value !== undefined && value !== "") params.set(key, String(value));
  return params.size ? `?${params}` : "";
}
// Each confirmation dialog holds one key, so a retried submit cannot apply twice.
function write<T>(path: string, body: object, key: string) {
  return adminRequest<T>(path, { method: "POST", body, headers: { "Idempotency-Key": key } });
}

export const adminKeys = {
  all: ["admin"] as const,
  session: () => ["admin", "session"] as const,
  summary: () => ["admin", "summary"] as const,
  list: (section: string, input: AdminQuery) => ["admin", section, "list", input] as const,
  detail: (section: string, id: string) => ["admin", section, "detail", id] as const,
};
type CoreWebhook = {
  id: string; eventId: string; eventType: string; provider: string; status: string; attempts: number;
  lastError: string | null; processedAt: string | null; nextAttemptAt: string | null; conflictCount: number;
  numberId: string | null; outboundMessageId: string | null; providerMessageId: string | null;
  occurredAt: string | null; receivedAt: string; upstreamAccountId: string; historicalOnly?: boolean;
  retryable: boolean; retryExhausted: boolean;
  payload?: unknown; normalizedPayload?: { externalNumberId?: string };
};
type CoreWebhookDetail = { event: CoreWebhook; attempts: { id: string; from_status: string; to_status: string; reason: string; created_at: string }[]; conflicts: unknown[] };
function webhookView(event: CoreWebhook, attempts: CoreWebhookDetail["attempts"] = []): AdminWebhook {
  return { ...event, providerAccountId: event.upstreamAccountId, leaseId: null,
    providerNumberId: event.normalizedPayload?.externalNumberId ?? null,
    retryable: event.retryable,
    retryExhausted: event.retryExhausted,
    history: attempts.map(item => ({ id: item.id, source: item.reason.startsWith("ADMIN_RETRY:") ? "ADMIN" : "AUTO", beforeStatus: item.from_status,
      afterStatus: item.to_status, error: item.reason, durationMs: null, createdAt: item.created_at })),
  };
}
export const sessionOptions = () =>
  queryOptions({
    queryKey: adminKeys.session(),
    queryFn: ({ signal }) => adminRequest<AdminSession>("/session", { signal }),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
export const plansOptions = () =>
  queryOptions({ queryKey: ["admin", "plans"], queryFn: ({ signal }) => adminRequest<AdminPlan[]>("/plans", { signal }) });
export const settingsOptions = () =>
  queryOptions({ queryKey: ["admin", "settings"], queryFn: ({ signal }) => adminRequest<AdminSettings>("/settings", { signal }) });
export const stockOptions = () =>
  queryOptions({ queryKey: ["admin", "numbers", "stats"], queryFn: ({ signal }) => adminRequest<RegionStock[]>("/numbers/stats", { signal }) });
export const integrationOptions = () => queryOptions({ queryKey: ['admin', 'integrations', 'pingcode'],
  queryFn: ({ signal }) => adminRequest<IntegrationConfig>('/integrations/pingcode', { signal }) });
export const integrationNumbersOptions = () => queryOptions({ queryKey: ['admin', 'integrations', 'pingcode', 'numbers'],
  queryFn: ({ signal }) => adminRequest<{ items: UpstreamNumber[]; total: number }>('/integrations/pingcode/numbers', { signal }), staleTime: 0 });
export const webhookSummaryOptions = () => queryOptions({ queryKey: ['admin', 'webhooks', 'summary'],
  queryFn: ({ signal }) => adminRequest<{ counts: Record<string, number>; retryExhausted: number }>('/webhooks/summary', { signal }) });
export const summaryOptions = () =>
  queryOptions({
    queryKey: adminKeys.summary(),
    queryFn: ({ signal }) => adminRequest<AdminSummary>("/summary", { signal }),
  });

type Sections = {
  users: AdminUser; numbers: AdminNumber; leases: AdminLease; orders: AdminOrder;
  messages: AdminMessage; webhooks: AdminWebhook; audit: AdminAudit;
};
export function listOptions<S extends keyof Sections>(section: S, input: AdminQuery) {
  return queryOptions({
    queryKey: adminKeys.list(section, input),
    queryFn: async ({ signal }) => {
      const data = await adminRequest<Page<Sections[S]>>(`/${section}${query(input)}`, { signal });
      if (section === "webhooks" && !adminMock) data.items = data.items.map(item => webhookView(item as unknown as CoreWebhook)) as unknown as Sections[S][];
      return data;
    },
    placeholderData: keepPreviousData,
  });
}
type Details = { users: UserDetail; numbers: NumberDetail; leases: LeaseDetail; orders: AdminOrder; webhooks: AdminWebhook };
export function detailOptions<S extends keyof Details>(section: S, id: string) {
  return queryOptions({
    queryKey: adminKeys.detail(section, id),
    queryFn: async ({ signal }) => {
      const data = await adminRequest<Details[S]>(`/${section}/${encodeURIComponent(id)}`, { signal });
      if (section === "webhooks" && !adminMock) {
        const detail = data as unknown as CoreWebhookDetail;
        return webhookView(detail.event, detail.attempts) as unknown as Details[S];
      }
      return data;
    },
  });
}

export const adminApi = {
  saveIntegration: (body: IntegrationInput, key: string) => write<{ enabled: boolean }>('/integrations/pingcode', body, key),
  checkIntegration: (key: string, demoMode: boolean) => write<IntegrationCheck>('/integrations/pingcode/check', { reason: demoMode ? '管理员检查本地模拟配置' : '管理员检查本地连接配置' }, key),
  syncIntegration: (mode: 'FULL' | 'INCREMENTAL' | 'MANUAL', reason: string, key: string) => write<IntegrationSync>('/integrations/pingcode/sync', { mode, reason }, key),
  userStatus: (id: string, body: { status: "ACTIVE" | "DISABLED"; reason: string }, key: string) =>
    write<{ changed: boolean }>(`/users/${id}/status`, body, key),
  resetPassword: (id: string, body: { newPassword: string; reason: string }, key: string) =>
    write<{ changed: boolean }>(`/users/${id}/password`, body, key),
  assignNumber: (id: string, body: { userId: string; term: number; amountMinor: number; note: string; reason: string }, key: string) =>
    write<AdminLease>(`/numbers/${id}/assign`, body, key),
  holdNumber: (id: string, body: { hold: boolean; reason: string }, key: string) =>
    write<AdminNumber>(`/numbers/${id}/hold`, body, key),
  endLease: (id: string, body: { reason: string }, key: string) =>
    write<AdminLease>(`/leases/${id}/end`, body, key),
  extendLease: (id: string, body: { days: number; amountMinor: number; note: string; reason: string }, key: string) =>
    write<AdminLease>(`/leases/${id}/extend`, body, key),
  retryWebhook: async (id: string, body: { reason: string }, key: string) => {
    const data = await write<CoreWebhookDetail>(`/webhooks/${id}/retry`, body, key);
    return adminMock ? data as unknown as AdminWebhook : webhookView(data.event, data.attempts);
  },
  createPlan: (body: PlanInput, key: string) => write<AdminPlan>("/plans", body, key),
  updatePlan: (id: string, body: PlanInput, key: string) => write<AdminPlan>(`/plans/${id}`, body, key),
  updateSettings: (body: AdminSettings & { reason: string }, key: string) => write<AdminSettings>("/settings", body, key),
  createNumber: (body: NumberInput & { reason: string }, key: string) => write<AdminNumber>("/numbers", body, key),
  // Preview neither writes nor audits, so it needs no idempotency key.
  previewImport: (rows: NumberInput[]) => adminRequest<ImportPreview>("/numbers/import/preview", { method: "POST", body: { rows } }),
  importNumbers: (body: { rows: NumberInput[]; reason: string }, key: string) => write<{ created: number }>("/numbers/import", body, key),
  updateNumber: (id: string, body: Omit<NumberInput, "number"> & { reason: string }, key: string) => write<AdminNumber>(`/numbers/${id}`, body, key),
  deleteNumber: (id: string, body: { reason: string }, key: string) => write<{ id: string; number: string }>(`/numbers/${id}/delete`, body, key),
  batchNumbers: (body: { ids: string[]; action: "release" | "hold"; reason: string }, key: string) => write<BatchResult>("/numbers/batch", body, key),
};

const codes: Record<string, string> = {
  ADMIN_REQUIRED: "当前账号没有管理员权限。",
  ADMIN_PROTECTED: "不能对管理员账号执行此操作。",
  USER_UNAVAILABLE: "目标用户不存在或已禁用。",
  NUMBER_UNAVAILABLE: "号码已被占用或已暂停，请刷新后重试。",
  LEASE_NOT_ACTIVE: "租约已结束或已变化，请刷新后重试。",
  WEBHOOK_NOT_RETRYABLE: "该事件当前状态不能重新处理。",
  IDEMPOTENCY_CONFLICT: "该操作已用不同内容提交过，请关闭弹窗重新操作。",
  PLAN_UNAVAILABLE: "该租期已下架或不存在，请重新选择。",
  NUMBER_IN_USE: "这个号码已有租用或订单记录，不能删除，可以改为暂停售卖。",
};
export function adminError(error: unknown) {
  if (!(error instanceof ApiError))
    return error instanceof DOMException && error.name === "TimeoutError"
      ? "请求超时，请刷新核对操作结果后再试。"
      : "无法连接服务，请重试。";
  if (codes[error.code]) return codes[error.code]!;
  if (error.status === 429) return "请求过于频繁，请稍后重试。";
  if (error.status >= 500) return "服务暂时不可用，请重试。";
  return error.message;
}
