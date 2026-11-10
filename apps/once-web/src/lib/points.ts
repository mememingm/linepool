import { useQuery } from "@tanstack/react-query";
import type { RechargeRules } from "@linepool/contracts";
import { useApp } from "../app/AppProvider";
import { request } from "./api";
import type { Term } from "./models";

export interface PointAccount { id: string; availablePoints: number; frozenPoints: number; status: string; sourceBreakdownAvailable: false; sources: null }
export interface PointConfig { configured: boolean; enabled: boolean; rules: RechargeRules | null; version: number; minMinor: number | null; maxMinor: number | null; dailyMinor: number | null; presetsMinor: number[]; currency: string | null; fractionDigits: number | null; exchangeAmountMinor: number | null; exchangePoints: number | null; pointsPerMinor: number | null; channelAvailable: boolean; demo: boolean; cashRefundAvailable: false }
export interface Recharge { id: string; orderNumber: string; amountMinor: number; points: number; currency: string; fractionDigits: number; status: string; environment: "DEMO" | "HISTORICAL"; createdAt: string; expiresAt: string; creditedAt: string | null; credited: boolean; purchaseIntentId: string | null; checkoutUrl: string | null; checkoutMethod: "POST" | null; paymentStatus: string; lastError: string | null; refundableMinor: null; cashRefundAvailable: false }
export interface PointEntry { id: string; kind: string; delta: number; frozenDelta: number; balanceAfter: number; frozenAfter: number; description: string; createdAt: string }
export interface PointRefund { id: string; rechargeId: string; amountMinor: number; currency: string; fractionDigits?: number; points: number; status: string; reason: string; createdAt: string }
export interface PointPage<T> { items: T[]; nextCursor: string | null; hasMore?: boolean }
export interface PurchaseIntent { id: string; kind: "RENT" | "RENEW"; number: string | null; leaseId: string | null; termDays: number; quoteVersion: number; pointsPrice: number; orderId: string | null; expired: boolean; priceChanged: boolean; availability: string; currentPlan: (Term & { active: boolean }) | null }
export const pointKeys = { account: (owner: string) => ["points", owner, "account"] as const, all: (owner: string) => ["points", owner] as const };
export function usePointAccount() {
  const { account } = useApp();
  return useQuery({ queryKey: pointKeys.account(account?.id ?? "guest"), queryFn: ({ signal }) => request<PointAccount>("/points/account", { signal }), enabled: Boolean(account) && account?.authKind !== "PINCLODE", staleTime: 10_000 });
}
export const formatPoints = (points: number) => `${points.toLocaleString("zh-CN")} 积分`;
export const planPoints = (term: Term) => term.pointsPrice;
export const pointStatus: Record<string, string> = { PENDING: "待支付", CHECKING: "正在确认", EXPIRED: "支付已超时，仍可查单", SUCCEEDED: "已到账", PAID: "历史已到账", PAID_UNCREDITED: "已收款，入账待核对", FAILED: "已失败", CANCELLED: "已取消", REFUNDING: "历史退款中", REFUNDED: "历史已退款", REQUESTED: "历史待审核", APPROVED: "历史已核准", PROCESSING: "处理中", REJECTED: "已拒绝", MANUAL_REVIEW: "需要人工核对" };
export const pointKind: Record<string, string> = { RECHARGE: "充值到账", COMPENSATION: "补偿积分", COMPENSATION_REVOKE: "补偿扣回", ORDER_RESERVE: "消费冻结", ORDER_CAPTURE: "消费确认", ORDER_RELEASE: "消费解冻", ORDER_REFUND: "消费退回", REFUND_RESERVE: "历史退款冻结", REFUND_CAPTURE: "历史现金退款完成", REFUND_RELEASE: "历史退款解冻" };
