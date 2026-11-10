import type pg from 'pg';
/** Import-safe fields only. Legacy hashes, sessions, reset tokens and configuration credentials never leave the source. */
export const sourceColumns = {
  User: 'id email role status lastLoginAt createdAt',
  PhoneNumber: 'id number countryCode countryName regionId regionName provider providerAccountId providerNumberId providerStatus resourceExpiresAt lastSyncedAt occupied holdReason smsEnabled source note createdAt',
  Lease: 'id userId phoneNumberId termDays priceMinor currency startedAt expiresAt createdAt status endedAt',
  Message: 'id leaseId sender title body code provider providerAccountId providerMessageId receivedAt createdAt readAt',
  OutboundMessage: 'id leaseId from to content provider providerAccountId providerMessageId idempotencyKey requestHash status providerStatus lastError attempts claimToken claimUntil lastCheckedAt lastEventAt createdAt updatedAt',
  Order: 'id userId leaseId phoneNumberId numberSnapshot kind termDays amountMinor currency status mockScenario attempts claimToken claimUntil checkedAt completedAt providerOrderId lastError evidence idempotencyKey requestHash createdAt settlementType pointsAmount quoteVersion fundsStatus reservationId',
  Payment: 'id orderId provider providerPaymentId amountMinor currency status createdAt',
  WebhookEvent: 'id provider providerAccountId providerNumberId providerMessageId occurredAt eventId payload status attempts payloadHash processedAt nextAttemptAt lastError leaseId outboundMessageId conflictCount lastConflictHash lastConflictAt receivedAt',
  WebhookAttempt: 'id eventId source beforeStatus afterStatus error durationMs createdAt',
  AuditLog: 'id userId action resourceId targetType reason details createdAt',
  Plan: 'id days priceMinor pointsPrice version currency label note active sortOrder createdAt updatedAt',
  AppSetting: 'key value updatedAt',
  AdminIdempotency: 'id key actorId requestHash result createdAt',
  PointAccount: 'id userId availablePoints frozenPoints sequence status',
  PointLot: 'id accountId rechargeId source issuedPoints availablePoints frozenPoints currency pointsPerMinor createdAt',
  PointLedger: 'id accountId sequence kind businessId availableDelta frozenDelta availableAfter frozenAfter actorId reason createdAt',
  PointReservation: 'id accountId kind businessId points status refundedPoints',
  PointAllocation: 'id reservationId lotId points refundedPoints',
  RechargeOrder: 'id userId amountMinor currency points pointsPerMinor status environment refundedMinor refundReservedMinor idempotencyKey requestHash purchaseIntentId expiresAt paidAt creditedAt latePayment createdAt',
  PaymentAttempt: 'id rechargeId provider merchant externalId status scenario checkoutUrl checkedAt claimToken claimUntil attempts lastError',
  PaymentReceipt: 'id rechargeId provider merchant transactionId amountMinor currency paidAt applied',
  PaymentEvent: 'id provider merchant eventId payloadHash payload status conflictCount lastError createdAt',
  RefundOrder: 'id userId rechargeId receiptId amountMinor points status kind reason adminReason actorId scenario externalId claimToken claimUntil attempts lastError idempotencyKey requestHash reservationId createdAt completedAt',
  PurchaseIntent: 'id userId kind number leaseId termDays quoteVersion pointsPrice orderId createdAt expiresAt',
  PointException: 'id businessKey userId kind details status resolution actorId createdAt resolvedAt',
} as const;
export type Entity = keyof typeof sourceColumns;
// pg to_jsonb preserves timestamp text and bigint values; all inspected source amounts are Prisma Int.
export type Row = Record<string, unknown>;
export type Source = Record<Entity, Row[]>;
export type Identity = { host: string; port: number; database: string; user: string };
export type Issue = { code: string; entity: string; sourceId: string; details: Row };
export type Evidence = { entity: Entity; sourceId: string };
export type UserDecision = {
  targetId: string; mode: 'CREATE' | 'EXISTING_ADMIN'; reason: string;
  expectedEmail: string; expectedRole: 'USER' | 'ADMIN'; expectedStatus: 'ACTIVE' | 'DISABLED';
  access: { method: 'EXISTING_CORE' | 'ADMIN_RESET'; administratorId?: string; procedure?: 'POST /api/once/admin/users/:id/password'; reason: string };
};
export type NumberDecision = {
  targetId: string; mode: 'CREATE' | 'MERGE'; reason: string; regionId: string;
  provider: 'demo' | 'pingcode' | 'pingcode-mock'; externalAccountId: string; externalNumberId: string | null;
  resourceStatus: 'LOCAL' | 'ONLINE' | 'OFFLINE' | 'ERROR'; evidence: Evidence[];
};
export type PeriodDecision = {
  id: string; leaseId: string; orderId: string; assignedAt: string; expiresAt: string;
  releasedAt: string | null; releaseReason: 'MANUAL' | 'EXPIRED' | 'REASSIGNED' | null;
  evidence: Evidence[]; reason: string;
  serviceEndResolution?: { kind: 'RECORDED_END'; approvedBy: string; approvedAt: string; approvalReference: string; reason: string };
};
export type Decisions = {
  version: 1; batchId: string; sourceSystem: string; source: Identity; target: Identity;
  approvedBy: string; reason: string;
  users: Record<string, UserDecision>;
  accounts: Record<string, { targetId: string; reason: string }>;
  numbers: Record<string, NumberDecision>;
  /** Explicit UUID remaps only; absent mapping preserves the original UUID. */
  ids: Record<string, { targetId: string; reason: string }>;
  /** Settings have text primary keys; assign reviewed UUID identities for the import registry. */
  settingIds: Record<string, string>;
  periods: PeriodDecision[];
  requests: Record<string, { payload: Row; evidence: Evidence[]; reason: string }>;
  adminOperations: Record<string, { action: string; targetId: string | null; key: string; payload: Row; evidence: Evidence[]; reason: string }>;
  /** Never invent or prefix provider keys. Each original provider/account pair needs reviewed provenance. */
  provenance: Record<string, { provider: 'demo' | 'pingcode' | 'pingcode-mock'; externalAccountId: string; evidence: Evidence[]; reason: string }>;
  settings: { actorId: string; rechargeRules?: Row; reason: string } | null;
};
export type Fact = { entity: string; sourceId: string; targetId: string; payload: Row };
export type WriteRow = { entity: string; sourceId: string; table: string; key: Row; values: Row; merge?: boolean };
export type Target = { identity: Identity; siteId: string | null; tables: Record<string, Row[]>; columns: Record<string, string[]> };
export type Plan = { facts: Fact[]; writes: WriteRow[]; blockers: Issue[]; notes: Issue[]; balances: Record<string, { userId: string; available: number; frozen: number; addedAvailable: number; addedFrozen: number }> };
export type Report = { version: 1; sourceIdentity: Identity; targetIdentity: Identity; source: Source; sourceDigest: string; targetDigest: string; decisionsDigest: string | null; targetSite: string | null; template: Decisions; plan: Plan; counts: Record<string, number> };
export type Client = pg.Client;
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export const provenanceKey = (provider: string, account: string) => JSON.stringify([provider, account]);
export const factKey = (entity: string, id: string) => `${entity}:${id}`;
export function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/password|secret|token|authorization|cookie|checkoutUrl/i.test(key)).map(([key, item]) => [key, clean(item)]));
  return value;
}
export async function equalJson(client: Client, left: unknown, right: unknown): Promise<boolean> {
  const { rows } = await client.query('SELECT $1::jsonb = $2::jsonb AS equal', [JSON.stringify(left), JSON.stringify(right)]);
  return rows[0].equal === true;
}
export function identityFromUrl(connectionString: string): Identity {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Import connections must name an explicit local PostgreSQL database');
  if (url.search || url.hash) throw new Error('Import URLs cannot override connection identity using query parameters');
  if (!url.pathname.slice(1) || !url.username) throw new Error('Import URLs require an explicit database and role');
  const port = Number(url.port || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PostgreSQL port');
  return { host: url.hostname.toLowerCase(), port, database: decodeURIComponent(url.pathname.slice(1)), user: decodeURIComponent(url.username) };
}
export function sameDatabase(left: Identity, right: Identity): boolean {
  // All permitted hostnames address this machine; role differences do not make independent databases.
  return left.port === right.port && left.database === right.database;
}
export const text = (value: unknown): string => { if (typeof value !== 'string') throw new Error('Expected source text'); return value; };
export function canonicalPhoneNumber(value: unknown): string {
  const number = text(value).replace(/[\s()-]/g, '');
  if (!/^\+[1-9][0-9]{6,14}$/.test(number)) throw new Error('Original number cannot be converted to E.164 by removing display separators');
  return number;
}
export const integer = (value: unknown): number => { if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Expected source integer'); return value; };
export const record = (value: unknown): Row => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object'); return value as Row; };
export const id = (row: Row): string => text(row.id);
