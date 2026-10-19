export type TaskStatus = 'PAYMENT_PENDING' | 'ALLOCATING' | 'WAITING_SMS' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED' | 'REVIEW_REQUIRED' | 'ALLOCATION_FAILED' | 'SMS_FAILED';
export type Policy = { refundOnExpiry: boolean; refundOnCancel: boolean; refundOnFailure: boolean; cooldownSeconds: number; blockSameServiceAfterUse: boolean };
export type Product = {
  id: string; service: string; serviceId: string; country: string; countryCode: string;
  priceCents: number; currency: string; durationSeconds: number;
  stock: number; enabled: boolean; canCancel: boolean; description: string; iconKey: string; rules: Policy;
};
export type DemoMessage = { id: string; text: string; code: string; receivedAt: string; isDemo: true };
export type Task = {
  id: string; orderId: string; productId: string; service: string; country: string; countryCode: string;
  phone: string | null; status: TaskStatus; createdAt: string; expiresAt: string;
  priceCents: number; currency: string; paymentStatus: string; settlementStatus: string;
  canCancel: boolean; rules: Policy; events: { state: TaskStatus; detail: string; createdAt: string }[];
  messages: DemoMessage[]; isDemo: true;
};
export type Order = {
  id: string; taskId: string; service: string; country: string; countryCode: string; phone: string | null; status: TaskStatus;
  priceCents: number; currency: string; paymentStatus: string;
  allocationStatus: 'ALLOCATED' | 'ALLOCATING' | 'NOT_ALLOCATED'; settlementStatus: string; createdAt: string;
};
export type WalletEntry = {
  id: string; taskId: string | null; kind: 'TEST_CREDIT' | 'HOLD' | 'CAPTURE' | 'REFUND';
  balanceDelta: number; heldDelta: number; balanceAfter: number; heldAfter: number; createdAt: string; isTest: true;
};
export type Bootstrap = LeaseSnapshot & {
  viewer: { id: string; name: string; email: string };
  products: Product[]; tasks: Task[]; orders: Order[]; ledger: WalletEntry[];
  wallet: { balanceCents: number; heldCents: number; currency: string; isTest: true };
  preferences: { theme: 'light' | 'dark' }; serverNow: string; mode: 'demo'; version: 3; provider: string;
};
export type AdminSnapshot = LeaseSnapshot & {
  leaseExceptions: { id: string; event_id: string; message_id: string; reason: string; received_at: number }[];
  mode: 'demo'; products: Product[]; services: { id: string; name: string; enabled: number }[];
  resources: { id: string; phone: string; countryCode: string; source: string; online: boolean; taskId: string | null;
    cooldownUntil: string; costCents: number; uses: number; successes: number; revenueCents: number;
    platforms: { id: string; name: string; state: string; cooldownUntil: string }[] }[];
  orders: Task[]; exceptions: { id: string; event_id: string; message_id: string; reason: string; received_at: number }[];
  pendingSettlements: { id: string; viewer_id: string; price_cents: number; order_state: string }[];
  audit: { id: string; actor: string; action: string; target: string; detail: string; created_at: number }[];
  stats: { totalOrders: number; completedOrders: number; successRate: number; revenueCents: number; resourceCostCents: number; reuseCount: number;
    byService: { name: string; count: number; successes: number; revenueCents: number }[];
    byCountry: { name: string; count: number; successes: number; revenueCents: number }[] };
};
export type PageId = 'tasks' | 'market' | 'history' | 'finance' | 'help' | 'admin';
export const isActive = (task: Task) => ['PAYMENT_PENDING', 'ALLOCATING', 'WAITING_SMS'].includes(task.status);
export const statusNames: Record<TaskStatus, string> = {
  PAYMENT_PENDING: '待支付', ALLOCATING: '分配中', WAITING_SMS: '等待验证码', COMPLETED: '接码成功',
  EXPIRED: '已超时', CANCELLED: '已取消', REVIEW_REQUIRED: '待核对', ALLOCATION_FAILED: '分配失败', SMS_FAILED: '接码失败',
};
export const paymentNames: Record<string, string> = { DEMO_ONLY: '旧版演示 · 未支付', TEST_HELD: '测试额度已预占', TEST_PAID: '测试额度已结算', TEST_REFUNDED: '测试额度已退回' };
export const settlementNames: Record<string, string> = { NOT_APPLICABLE: '旧版样例 · 无结算', RESERVED: '预占中', TEST_SETTLED: '测试已结算', TEST_REFUNDED: '测试已退回', REVIEW_REQUIRED: '待人工结算' };
export const ledgerNames: Record<WalletEntry['kind'], string> = { TEST_CREDIT: '测试额度', HOLD: '订单预占', CAPTURE: '测试租金 / 历史结算', REFUND: '额度退回' };
export const countries: Record<string, string> = { US: '美国', GB: '英国', CA: '加拿大' };
export const money = (cents: number, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
export const shortId = (id: string) => id.replace(/^(tsk|ord)_/, '').slice(0, 8).toUpperCase();
export const dateTime = (date: string) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date));

export type LeasePlan = { id: string; days: 7 | 30; priceCents: number; version: number; enabled: boolean; currency: string };
export type LeaseResource = {
  id: string; phone: string; countryCode: string; purpose: 'SHARED' | 'EXCLUSIVE' | 'CUSTOMER_OWNED';
  availability: 'UNLISTED' | 'AVAILABLE' | 'LEASED' | 'REVIEW'; online: boolean; available: boolean;
  leaseId?: string | null; legacyTaskId?: string | null; receiveSupported: boolean; sendSupported: false; capability: string; isDemo: true;
};
export type Lease = {
  id: string; resourceId: string; phone: string; countryCode: string; status: 'ACTIVE' | 'FAILED' | 'EXPIRED' | 'RELEASED';
  online: boolean; startedAt: string; expiresAt: string; canRenew: boolean; isDemo: true;
  upstreamExpiresAt: null; usage: null; receiveSupported: true; sendSupported: false;
  messages: { id: string; text: string; code: string | null; receivedAt: string; isDemo: true }[];
  events: { kind: string; detail: string; createdAt: string }[];
};
export type LeaseOrder = { id: string; leaseId: string; phone: string; kind: 'OPEN' | 'RENEW'; status: 'TEST_PAID' | 'FAILED'; days: number; priceCents: number; planVersion: number; ledgerId: string | null; createdAt: string; expiresAt: string };
export type LeaseSnapshot = { leasePlans: LeasePlan[]; leaseResources: LeaseResource[]; leases: Lease[]; leaseOrders: LeaseOrder[] };
export const leaseStatusNames: Record<Lease['status'], string> = { ACTIVE: '租赁中', FAILED: '开通失败', EXPIRED: '已到期 · 待回收', RELEASED: '已释放' };
