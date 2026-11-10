// Admin API contract. The backend implementation is tracked in docs/ONCE-ADMIN-API.md;
// keep both in sync when a field changes.
export type AdminRole = "USER" | "ADMIN";
export type UserStatus = "ACTIVE" | "DISABLED";
export type SaleStatus = "AVAILABLE" | "OCCUPIED" | "HELD" | "EXPIRED_HELD" | "UNAVAILABLE" | "RESERVED";
interface HistoricalSource { historicalOnly?: boolean; externalAccountId?: string }

export interface AdminSession {
  id: string;
  email: string;
  role: AdminRole;
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
export interface AdminQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  userId?: string;
  leaseId?: string;
  provider?: string;
  direction?: string;
  eventType?: string;
  from?: string;
  to?: string;
}
export interface AdminUser {
  id: string;
  email: string;
  role: AdminRole;
  authKind?: "LOCAL" | "PINCLODE";
  agentId?: string | null;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string | null;
  activeLeaseCount: number;
  leaseCount: number;
  orderCount: number;
}
export interface AdminNumber extends HistoricalSource {
  id: string;
  number: string;
  countryCode: string;
  countryName: string;
  regionId: string;
  regionName: string;
  provider: string;
  providerNumberId: string | null;
  providerStatus: string | null;
  resourceExpiresAt: string | null;
  lastSyncedAt: string | null;
  smsEnabled: boolean;
  saleStatus: SaleStatus;
  holdReason: string | null;
  currentLease: { id: string; userId: string; email: string; expiresAt: string } | null;
  /** "SEED" demo fixture, "ADMIN" entered by an operator, "SYNC" imported from an upstream provider. */
  source: string;
  note: string | null;
  /** When the last lease expired, while the number is still held for that user. */
  heldSince: string | null;
  heldBy: string | null;
  /** When maintenance will put it back on sale; null if no cooldown is configured. */
  autoReleaseAt: string | null;
  /** True when the number has never been leased, so it can be deleted outright. */
  deletable: boolean;
  createdAt: string;
}
export interface AdminLease extends HistoricalSource {
  id: string;
  userId: string;
  email: string;
  phoneNumberId: string;
  number: string;
  countryName: string;
  regionName: string;
  provider: string;
  term: number;
  priceMinor: number | null;
  currency: string | null;
  status: "ACTIVE" | "EXPIRED_HELD" | "ENDED" | "RELEASED";
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  messageCount: number;
  outboundCount: number;
}
export interface AdminOrder extends HistoricalSource {
  pointsAmount?: number;
  refundedPoints?: number;
  fundsStatus?: string;
  settlementType?: string;
  id: string;
  userId: string;
  email: string;
  leaseId: string | null;
  number: string | null;
  kind: "RENT" | "RENEW" | "ADMIN_ASSIGN" | "ADMIN_EXTEND";
  termDays: number;
  amountMinor: number | null;
  currency: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  providerOrderId: string | null;
  createdAt: string;
  completedAt: string | null;
  note: string | null;
}
export interface AdminMessage extends HistoricalSource {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  leaseId: string;
  userId: string;
  email: string;
  number: string;
  peer: string;
  body: string;
  code: string | null;
  status: string | null;
  readAt: string | null;
  provider: string;
  providerMessageId: string | null;
  lastError: string | null;
  at: string;
}
export interface AdminWebhook extends HistoricalSource {
  id: string;
  provider: string;
  eventId: string;
  status: string;
  providerAccountId: string;
  eventType: string;
  retryable: boolean;
  retryExhausted: boolean;
  attempts: number;
  lastError: string | null;
  conflictCount: number;
  leaseId: string | null;
  outboundMessageId: string | null;
  providerNumberId: string | null;
  providerMessageId: string | null;
  occurredAt: string | null;
  receivedAt: string;
  processedAt: string | null;
  nextAttemptAt: string | null;
  payload?: unknown;
  history?: { id: string; source: string; beforeStatus: string; afterStatus: string; error: string | null; durationMs: number | null; createdAt: string }[];
}
export interface AdminAudit {
  id: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  createdAt: string;
}
export interface AdminSummary {
  users: number;
  activeLeases: number;
  availableNumbers: number;
  heldNumbers: number;
  /** Numbers whose lease expired and are still held for the last user. */
  expiredHeldNumbers: number;
  /** Regions at or below `lowStockThreshold` sellable numbers. */
  lowStock: { countryCode: string; regionId: string; regionName: string; available: number }[];
  lowStockThreshold: number;
  todayOrders: number;
  todayRevenueMinor: number | null;
  currency: string | null;
  revenueAvailable?: boolean;
  expiringLeases: number;
  failedOutbound: number;
  failedWebhooks: number;
  uncertainOrders: number;
  recentOrders: AdminOrder[];
  expiring: AdminLease[];
  integrations: {
    demoMode: boolean;
    pingcodeConfigured: boolean;
    receiveWebhookConfigured: boolean;
    paymentsConnected: boolean;
  };
}
export interface UserDetail { user: AdminUser; leases: AdminLease[]; orders: AdminOrder[] }
export interface NumberDetail { number: AdminNumber; leases: AdminLease[] }
export interface LeaseDetail { lease: AdminLease; orders: AdminOrder[]; messages: AdminMessage[] }
export interface AdminPlan {
  id: string;
  pointsPrice?: number;
  version?: number;
  days: number;
  priceMinor: number;
  currency: string;
  label: string;
  note: string;
  active: boolean;
  sortOrder: number;
  /** First-time rentals sold on this term (customer purchases and manual activations). */
  orderCount: number;
  updatedAt: string;
}
export interface PlanInput { days: number; priceMinor: number; pointsPrice: number; currency: string; label: string; note: string; active: boolean; sortOrder: number; version?: number; reason: string }
export interface AdminSettings { cooldownDays: number | null; version?: number }
export interface RegionStock { countryCode: string; regionId: string; regionName: string; total: number; available: number; occupied: number; held: number; expiredHeld?: number; unavailable?: number }
export interface NumberInput { number: string; countryCode: string; regionId: string; regionName: string; note?: string; providerNumberId?: string; resourceExpiresAt: string }
export interface ImportPreview { valid: (NumberInput & { countryName: string })[]; errors: { line: number; message: string }[] }
export interface BatchResult { changed: number; skipped: { id: string; number: string; message: string }[] }
