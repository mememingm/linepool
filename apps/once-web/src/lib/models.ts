import type { User } from "@linepool/contracts";
import usStates from "./us-states.json";

export type Account = Pick<User, "id" | "email" | "role" | "authKind" | "agentId"> & Partial<Pick<User, "displayName" | "isDemo" | "pointsBalance" | "createdAt">>;
export interface PhoneNumber {
  id: string;
  number: string;
  countryCode: string;
  countryName: string;
  regionId?: string;
  regionName: string;
  demo?: boolean;
}
export interface Lease extends PhoneNumber {
  term: number;
  price: number | null;
  currency: string | null;
  startedAt: string;
  expiresAt: string;
  demo: boolean;
  historicalOnly?: boolean;
  status?: string;
  unreadCount?: number;
  smsSendQuota?: { total: number; used: number; remaining: number };
  smsSend?: { enabled: boolean; demo: boolean; reason: string | null };
}
export interface OutboundMessage {
  id: string;
  leaseId: string;
  number: string;
  to: string;
  content: string;
  status: "PENDING" | "SUBMITTING" | "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "UNDELIVERABLE" | "FAILED" | "UNCERTAIN";
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  providerMessageId: string | null;
  demo: boolean;
}
export interface Message {
  id: string;
  leaseId?: string;
  sender: string;
  title: string;
  body: string;
  code: string | null;
  receivedAt: string;
  isRead?: boolean;
  readAt?: string | null;
}
export interface Order {
  points?: number;
  settlementType?: string;
  fundsStatus?: string;
  id: string;
  leaseId: string | null;
  number: string | null;
  kind: string;
  term: number;
  amount: number | null;
  currency: string | null;
  status: string;
  createdAt: string;
}
export interface Snapshot {
  lease: Lease | null;
  leases: Lease[];
  messages: Message[];
  bills: Order[];
  messageCount: number;
  billsCount: number;
  demo: boolean;
  truncated: { messages: boolean; bills: boolean };
}
export interface MutationResult {
  leaseId: string | null;
  orderId: string;
  replayed: boolean;
  status: string;
}
export interface MockService {
  enabled: boolean;
  scene: string;
  scenes: Record<string, string>;
  request(path: string, options?: RequestOptions): Promise<unknown>;
  markRead(leaseId: string, messageId?: string): Promise<void>;
  reset(scene: string): void;
}
export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  keepalive?: boolean;
}
declare global {
  interface Window {
    OnceMock?: MockService;
  }
}
export type LeaseStatus = "active" | "warning" | "expired" | "unknown";
export const countries = [
  {
    code: "US",
    name: "美国",
    dial: "+1",
    detail: "按州 / 城市选择",
    available: true,
  },
];
export const regions: Record<
  string,
  { id: string; name: string; area: string; detail: string }[]
> = {
  US: [
    {
      id: "all",
      name: "全美随机",
      area: "各州区号",
      detail: "混合展示美国各州的当前可选号码",
    },
    ...usStates.map((state) => ({
      id: state.id,
      name: state.name,
      area: state.areaCodes.join(" / "),
      detail: `${state.name}可选区号`,
    })),
  ],
};
export interface Term { id?: string; days: number; price: number; pointsPrice: number; version: number; currency: string; active: boolean; label: string; note: string }
export const localDemo = () => Boolean(window.OnceMock?.enabled);
export const sourceKey = () =>
  localDemo() ? `mock:${window.OnceMock!.scene}` : "api";
export function leaseModel(lease: Lease, now = Date.now()) {
  const start = new Date(lease.startedAt).getTime(),
    end = new Date(lease.expiresAt).getTime();
  const known = Number.isFinite(start) && Number.isFinite(end) && end > start;
  // An operator can end a lease before its expiry; the backend status wins over the dates.
  const ended = lease.status === "ENDED" || lease.status === "RELEASED";
  const remaining = ended ? 0 : known
    ? Math.max(0, Math.ceil((end - now) / 86400000))
    : null;
  const status: LeaseStatus = ended
    ? "expired"
    : !known
    ? "unknown"
    : end <= now
      ? "expired"
      : end - now <= 3 * 86400000
        ? "warning"
        : "active";
  return {
    remaining,
    status,
    label: ended ? "已结束" : {
      active: "使用中",
      warning: "即将到期",
      expired: "已到期",
      unknown: "租期待确认",
    }[status],
    progress: known
      ? Math.min(
          100,
          Math.max(0, Math.round(((now - start) / (end - start)) * 100)),
        )
      : null,
  };
}
export const canRenew = (snapshot: Snapshot) => Boolean(
  snapshot.lease && !snapshot.lease.historicalOnly && Number.isFinite(Date.parse(snapshot.lease.expiresAt)) &&
  ["ACTIVE", "EXPIRED_HELD"].includes(snapshot.lease.status ?? "ACTIVE"),
);
export function sortedLeases(leases: Lease[]) {
  const rank = { warning: 0, active: 1, unknown: 2, expired: 3 };
  return [...leases].sort(
    (a, b) =>
      rank[leaseModel(a).status] - rank[leaseModel(b).status] ||
      a.expiresAt.localeCompare(b.expiresAt),
  );
}
export function validateSnapshot(value: unknown, leaseId = ""): Snapshot {
  const data = value as Snapshot | null;
  if (
    !data ||
    !Array.isArray(data.leases) ||
    !Array.isArray(data.messages) ||
    !Array.isArray(data.bills) ||
    !Object.hasOwn(data, "lease") ||
    (leaseId && data.lease?.id !== leaseId)
  )
    throw new Error("账户数据格式不完整，请重试。");
  return data;
}
export const formatMoney = (value: number | null, currency: string | null = "USD") => {
  if (typeof value !== "number" || !Number.isFinite(value) || !currency) return "暂未提供";
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
};
export const formatDate = (date: string | number) =>
  date != null && Number.isFinite(new Date(date).getTime())
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(date))
    : "未知";
export const formatDateTime = (date: string) =>
  date != null && Number.isFinite(new Date(date).getTime())
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(date))
    : "未知";
export const leasePath = (
  page: string,
  id?: string | null,
  extra?: Record<string, string>,
) => {
  const params = new URLSearchParams(extra);
  if (id) params.set("leaseId", id);
  return `/app/${page}${params.size ? `?${params}` : ""}`;
};
export const selectionKey = (owner: string) =>
  `once-selected:${sourceKey()}:${owner}`;
export function savedSelection(owner: string) {
  try {
    return localStorage.getItem(selectionKey(owner)) || "";
  } catch {
    return "";
  }
}
export function messagesForView(data: Snapshot): Message[] {
  return data.messages.map((message) => ({
    ...message,
    leaseId: data.lease?.id,
    isRead: message.isRead ?? Boolean(message.readAt),
  }));
}
export function errorMessage(
  error: unknown,
  fallback = "请求未完成，请稍后重试。",
) {
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "请求超时，请检查连接后重试。";
  if (error instanceof TypeError) return "无法连接服务，请检查网络后重试。";
  if (error instanceof Error && "status" in error && error.status === 429)
    return "请求过于频繁，请稍后重试。";
  return error instanceof Error ? error.message : fallback;
}
