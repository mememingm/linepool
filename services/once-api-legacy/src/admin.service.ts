import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DbService } from './db.service';
import { EventsService } from './events.service';
import { IncomingService } from './incoming.service';
import { OutboundService } from './outbound.service';
import { passwordHash } from './auth';
import { cooldownDays, cooldownKey, day, fingerprint, lockPhone, lockUser, planFor, releaseNumber, transactionOptions } from './business';
import { pcConfigured } from './pingcode.client';
import { settings } from './config';

type QueryInput = Record<string, unknown>;
type WriteInput = Record<string, unknown>;
type Tx = Prisma.TransactionClient;

type UserWithCounts = Prisma.UserGetPayload<{ include: { _count: { select: { leases: true; orders: true } }; leases: { select: { status: true; expiresAt: true } } } }>;
type LeaseWithRelations = Prisma.LeaseGetPayload<{ include: { user: true; phoneNumber: true; _count: { select: { messages: true; outbound: true } } } }>;
type NumberWithLeases = Prisma.PhoneNumberGetPayload<{ include: { leases: { include: { user: true } } } }>;
type OrderWithRelations = Prisma.OrderGetPayload<{ include: { user: true; lease: { include: { phoneNumber: true } }; phoneNumber: true } }> & { reservation?: { refundedPoints: number } | null };
type MessageWithRelations = Prisma.MessageGetPayload<{ include: { lease: { include: { user: true; phoneNumber: true } } } }>;
type OutboundWithRelations = Prisma.OutboundMessageGetPayload<{ include: { lease: { include: { user: true; phoneNumber: true } } } }>;

type Mutation<T> = { value: T; targetType: string; targetId: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;
const errorWithCode = (message: string, code: string, status = 409) => new (status === 400 ? BadRequestException : ConflictException)({ message, code });
const notFound = (message = '记录不存在或已变化。') => new NotFoundException({ message, code: 'NOT_FOUND' });

function validateReason(body: WriteInput) {
  const reason = text(body.reason);
  if (reason.length < 3 || reason.length > 500) throw errorWithCode('操作原因需要 3–500 个字符。', 'VALIDATION_ERROR', 400);
  return reason;
}
function validateKey(key: unknown) {
  if (typeof key !== 'string' || !uuid.test(key)) throw errorWithCode('Idempotency-Key 必须是 UUID。', 'VALIDATION_ERROR', 400);
  return key;
}
function page<T>(rows: T[], query: QueryInput) {
  const requested = Number(query.page);
  const requestedSize = Number(query.pageSize);
  const pageSize = [10, 20, 50].includes(requestedSize) ? requestedSize : 20;
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const current = Math.min(Math.max(1, Number.isInteger(requested) && requested > 0 ? requested : 1), totalPages);
  return { items: rows.slice((current - 1) * pageSize, current * pageSize), page: current, pageSize, totalItems, totalPages };
}
function includeSearch(query: QueryInput) {
  const search = text(query.search);
  return search.length > 200 ? search.slice(0, 200) : search;
}
const countries: Record<string, string> = { US: '美国', CA: '加拿大' };
/** A region with this many or fewer sellable numbers is flagged on the overview. */
const lowStockThreshold = 3;
/** North American numbers in the stored "+1 AAA NNN NNNN" form; null when the input is not a valid NANP number. */
function normalizeNumber(raw: unknown) {
  let digits = typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
  if (digits.length === 10) digits = '1' + digits;
  if (!/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}
type NumberInput = { number: string; countryCode: string; countryName: string; regionId: string; regionName: string; note: string | null };
/** Validates one manually entered number; returns the row to store or a Chinese error message. */
function numberInput(body: Record<string, unknown>): NumberInput | string {
  const number = normalizeNumber(body.number);
  if (!number) return '号码格式不正确，请填写 10 位北美号码，例如 +1 212 555 0100。';
  const countryCode = text(body.countryCode).toUpperCase();
  if (!countries[countryCode]) return '国家只支持 US 或 CA。';
  const regionId = text(body.regionId).toLowerCase(), regionName = text(body.regionName);
  if (!/^[a-z]{2,8}$/.test(regionId) || !regionName || regionName.length > 40) return '请选择有效的州 / 省。';
  const note = text(body.note);
  if (note.length > 200) return '备注不能超过 200 个字符。';
  return { number, countryCode, countryName: countries[countryCode]!, regionId, regionName, note: note || null };
}
function amountInput(value: unknown) {
  if (value === undefined || value === null || value === '') return 0;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100000000) throw errorWithCode('收款金额无效。', 'VALIDATION_ERROR', 400);
  return Number(value);
}
function adminLeaseStatus(row: { status: string; expiresAt: Date }) {
  if (row.status === 'ENDED' || row.status === 'RELEASED') return 'ENDED' as const;
  if (row.status === 'EXPIRED_HELD' || (row.status === 'ACTIVE' && row.expiresAt.getTime() <= Date.now())) return 'EXPIRED_HELD' as const;
  return 'ACTIVE' as const;
}

@Injectable()
export class AdminService {
  constructor(private readonly db: DbService, private readonly incoming: IncomingService,
    private readonly outbound: OutboundService, private readonly events: EventsService) {}

  private async mutate<T>(actorId: string, keyInput: unknown, body: WriteInput,
    operation: (tx: Tx, reason: string, key: string) => Promise<Mutation<T>>) {
    const key = validateKey(keyInput);
    const reason = validateReason(body);
    const requestHash = fingerprint(body);
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'admin:idempotency:' + key},0))`;
      const previous = await tx.adminIdempotency.findUnique({ where: { key } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw errorWithCode('该操作已用不同内容提交过，请关闭弹窗重新操作。', 'IDEMPOTENCY_CONFLICT');
        if (previous.result === null) throw errorWithCode('该操作正在处理中，请稍后刷新核对结果。', 'IDEMPOTENCY_IN_PROGRESS');
        return previous.result as T;
      }
      const mutation = await operation(tx, reason, key);
      await tx.adminIdempotency.create({ data: {
        id: randomUUID(), key, actorId, requestHash, result: mutation.value as unknown as Prisma.InputJsonValue,
      } });
      await tx.auditLog.create({ data: {
        userId: actorId, action: mutation.targetType === 'user' ? 'USER_STATUS' : '', resourceId: mutation.targetId,
        targetType: mutation.targetType, reason,
      } });
      return mutation.value;
    }, transactionOptions);
  }

  /** Idempotent, audited admin write. Batch operations pass `audits` to log one entry per affected record. */
  private async recordMutation<T>(actorId: string, keyInput: unknown, body: WriteInput, action: string,
    operation: (tx: Tx, reason: string, key: string) => Promise<{ value: T; targetId: string; audits?: { action: string; targetId: string }[] }>) {
    const key = validateKey(keyInput);
    const reason = validateReason(body);
    const requestHash = fingerprint(body);
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'admin:idempotency:' + key},0))`;
      const previous = await tx.adminIdempotency.findUnique({ where: { key } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw errorWithCode('该操作已用不同内容提交过，请关闭弹窗重新操作。', 'IDEMPOTENCY_CONFLICT');
        if (previous.result === null) throw errorWithCode('该操作正在处理中，请稍后刷新核对结果。', 'IDEMPOTENCY_IN_PROGRESS');
        return previous.result as T;
      }
      const mutation = await operation(tx, reason, key);
      await tx.adminIdempotency.create({ data: { id: randomUUID(), key, actorId, requestHash, result: mutation.value as unknown as Prisma.InputJsonValue } });
      const audits = mutation.audits ?? [{ action, targetId: mutation.targetId }];
      if (audits.length) await tx.auditLog.createMany({ data: audits.map(entry => ({ userId: actorId, action: entry.action, resourceId: entry.targetId, targetType: actionTarget(entry.action), reason })) });
      return mutation.value;
    }, transactionOptions);
  }

  private async userView(tx: Tx, id: string) {
    const user = await tx.user.findUnique({ where: { id }, include: { _count: { select: { leases: true, orders: true } }, leases: { select: { status: true, expiresAt: true } } } });
    if (!user) throw notFound();
    return this.mapUser(user);
  }
  private mapUser(user: UserWithCounts) {
    return { id: user.id, email: user.email, role: user.role === 'ADMIN' ? 'ADMIN' as const : 'USER' as const,
      status: user.status === 'DISABLED' ? 'DISABLED' as const : 'ACTIVE' as const, createdAt: user.createdAt.toISOString(),
      lastLoginAt: iso(user.lastLoginAt), activeLeaseCount: user.leases.filter(l => l.status === 'ACTIVE' && l.expiresAt.getTime() > Date.now()).length,
      leaseCount: user._count.leases, orderCount: user._count.orders };
  }
  private mapLease(row: LeaseWithRelations | (Prisma.LeaseGetPayload<{ include: { user: true; phoneNumber: true } }>)) {
    const counts = '_count' in row && row._count ? row._count : { messages: 0, outbound: 0 };
    return { id: row.id, userId: row.userId, email: row.user.email, phoneNumberId: row.phoneNumberId, number: row.phoneNumber.number,
      countryName: row.phoneNumber.countryName, regionName: row.phoneNumber.regionName, provider: row.phoneNumber.provider,
      term: row.termDays, priceMinor: row.priceMinor, currency: row.currency, status: adminLeaseStatus(row), startedAt: row.startedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(), endedAt: iso(row.endedAt), messageCount: counts.messages, outboundCount: counts.outbound };
  }
  private mapNumber(row: NumberWithLeases, cooldown: number | null) {
    const now = Date.now();
    const current = row.leases.find(lease => lease.status === 'ACTIVE' && lease.expiresAt.getTime() > now);
    // An expired lease keeps the number for its last user until it is released.
    const expired = current ? undefined : row.leases.find(lease => lease.status === 'EXPIRED_HELD' || (lease.status === 'ACTIVE' && lease.expiresAt.getTime() <= now));
    const saleStatus = current ? 'OCCUPIED' as const : expired ? 'EXPIRED_HELD' as const : row.occupied ? 'OCCUPIED' as const : row.holdReason ? 'HELD' as const : 'AVAILABLE' as const;
    const heldSince = expired ? expired.endedAt ?? expired.expiresAt : null;
    return { id: row.id, number: row.number, countryCode: row.countryCode, countryName: row.countryName, regionId: row.regionId, regionName: row.regionName,
      provider: row.provider, providerNumberId: row.providerNumberId, providerStatus: row.providerStatus, resourceExpiresAt: iso(row.resourceExpiresAt),
      lastSyncedAt: iso(row.lastSyncedAt), smsEnabled: row.smsEnabled, source: row.source, note: row.note, saleStatus, holdReason: row.holdReason,
      currentLease: current ? { id: current.id, userId: current.userId, email: current.user.email, expiresAt: current.expiresAt.toISOString() } : null,
      heldSince: iso(heldSince), heldBy: expired ? expired.user.email : null,
      autoReleaseAt: heldSince && cooldown !== null ? new Date(heldSince.getTime() + cooldown * day).toISOString() : null,
      deletable: row.leases.length === 0 && !row.occupied, createdAt: row.createdAt.toISOString() };
  }
  private mapOrder(row: OrderWithRelations) {
    return { id: row.id, userId: row.userId, email: row.user.email, leaseId: row.leaseId, number: row.numberSnapshot || row.phoneNumber?.number || row.lease?.phoneNumber.number || null,
      kind: row.kind, settlementType: row.settlementType, pointsAmount: row.pointsAmount, refundedPoints: row.reservation?.refundedPoints, fundsStatus: row.fundsStatus, termDays: row.termDays, amountMinor: row.amountMinor, currency: row.currency, status: row.status, attempts: row.attempts,
      lastError: row.lastError, providerOrderId: row.providerOrderId, createdAt: row.createdAt.toISOString(), completedAt: iso(row.completedAt),
      note: orderNote(row.evidence) };
  }
  private mapInbound(row: MessageWithRelations) {
    return { id: row.id, direction: 'INBOUND' as const, leaseId: row.leaseId, userId: row.lease.userId, email: row.lease.user.email,
      number: row.lease.phoneNumber.number, peer: row.sender, body: row.body, code: row.code, status: null, readAt: iso(row.readAt),
      provider: row.provider, providerMessageId: row.providerMessageId, lastError: null, at: row.receivedAt.toISOString() };
  }
  private mapOutbound(row: OutboundWithRelations) {
    return { id: row.id, direction: 'OUTBOUND' as const, leaseId: row.leaseId, userId: row.lease.userId, email: row.lease.user.email,
      number: row.lease.phoneNumber.number, peer: row.to, body: row.content, code: null, status: row.status, readAt: null,
      provider: row.provider, providerMessageId: row.providerMessageId, lastError: row.lastError, at: row.createdAt.toISOString() };
  }
  private mapWebhook(row: Prisma.WebhookEventGetPayload<{}>, includePayload = true) {
    const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : {};
    const eventType = typeof payload.event === 'string' ? payload.event : row.provider.startsWith('demo-inbox:') ? 'demo.received' : 'unknown';
    const supported = (row.provider === 'pingcode' && row.providerAccountId === settings.pingcode.accountId && ['sms.received', 'sms.send.status_changed'].includes(eventType)) || row.provider.startsWith('demo-inbox:');
    return { id: row.id, provider: row.provider, providerAccountId: row.providerAccountId, eventType,
      retryable: supported && (['FAILED', 'UNMATCHED', 'QUARANTINED', 'RECEIVED'].includes(row.status) || (row.status === 'PROCESSING' && Boolean(row.nextAttemptAt && row.nextAttemptAt <= new Date()))),
      retryExhausted: ['FAILED', 'UNMATCHED'].includes(row.status) && row.attempts >= (row.provider === 'pingcode' ? 20 : 10),
      eventId: row.eventId, status: row.status, attempts: row.attempts, lastError: row.lastError,
      conflictCount: row.conflictCount, leaseId: row.leaseId, outboundMessageId: row.outboundMessageId, providerNumberId: row.providerNumberId,
      providerMessageId: row.providerMessageId, occurredAt: iso(row.occurredAt), receivedAt: iso(row.receivedAt),
      processedAt: iso(row.processedAt), nextAttemptAt: iso(row.nextAttemptAt), ...(includePayload ? { payload: row.payload } : {}) };
  }

  async webhookDetail(id: string) {
    const event = await this.db.webhookEvent.findUnique({ where: { id }, include: { processingHistory: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50 } } });
    if (!event) throw notFound();
    return { ...this.mapWebhook(event), history: event.processingHistory };
  }
  async webhookSummary() {
    const grouped = await this.db.webhookEvent.groupBy({ by: ['status'], _count: { _all: true } });
    return { counts: Object.fromEntries(grouped.map(row => [row.status, row._count._all])),
      retryExhausted: await this.db.webhookEvent.count({ where: { status: { in: ['FAILED', 'UNMATCHED'] }, attempts: { gte: 20 } } }) };
  }

  async list(section: string, query: QueryInput) {
    const search = includeSearch(query), status = text(query.status), userId = text(query.userId);
    if (section === 'users') {
      const where: Prisma.UserWhereInput = search ? { OR: [{ email: { contains: search, mode: 'insensitive' } }, ...(uuid.test(search) ? [{ id: { equals: search } }] : [])] } : {};
      if (status === 'ADMIN') where.role = 'ADMIN'; else if (status === 'ACTIVE' || status === 'DISABLED') where.status = status;
      const rows = await this.db.user.findMany({ where, include: { _count: { select: { leases: true, orders: true } }, leases: { select: { status: true, expiresAt: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
      return page(rows.map(row => this.mapUser(row)), query);
    }
    if (section === 'numbers') {
      const where: Prisma.PhoneNumberWhereInput = search ? { OR: [{ number: { contains: search, mode: 'insensitive' } }, { providerNumberId: { contains: search, mode: 'insensitive' } }, { note: { contains: search, mode: 'insensitive' } }, { regionName: { contains: search, mode: 'insensitive' } }, { leases: { some: { user: { email: { contains: search, mode: 'insensitive' } } } } }] } : {};
      if (text(query.provider)) where.provider = text(query.provider);
      const rows = await this.db.phoneNumber.findMany({ where, include: { leases: { include: { user: true }, orderBy: { startedAt: 'desc' } } }, orderBy: [{ number: 'asc' }, { id: 'asc' }] });
      const cooldown = await cooldownDays(this.db);
      return page(rows.map(row => this.mapNumber(row, cooldown)).filter(row => !status || row.saleStatus === status), query);
    }
    if (section === 'leases') {
      const where: Prisma.LeaseWhereInput = { ...(userId ? { userId } : {}), ...(search ? { OR: [...(uuid.test(search) ? [{ id: { equals: search } }] : []), { phoneNumber: { number: { contains: search, mode: 'insensitive' } } }, { user: { email: { contains: search, mode: 'insensitive' } } }] } : {}) };
      const rows = await this.db.lease.findMany({ where, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } }, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }] });
      const mapped = rows.map(row => this.mapLease(row)).filter(row => !status || (status === 'EXPIRING' ? row.status === 'ACTIVE' && Date.parse(row.expiresAt) > Date.now() && Date.parse(row.expiresAt) - Date.now() <= 3 * day : row.status === status));
      return page(mapped, query);
    }
    if (section === 'orders') {
      const where: Prisma.OrderWhereInput = { ...(userId ? { userId } : {}), ...(search ? { OR: [...(uuid.test(search) ? [{ id: { equals: search } }] : []), { numberSnapshot: { contains: search, mode: 'insensitive' } }, { user: { email: { contains: search, mode: 'insensitive' } } }] } : {}) };
      const rows = await this.db.order.findMany({ where, include: { user: true, lease: { include: { phoneNumber: true } }, phoneNumber: true, reservation: { select: { refundedPoints: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
      const mapped = rows.map(row => this.mapOrder(row)).filter(row => !status || (status === 'TODAY' ? Date.now() - Date.parse(row.createdAt) < day : status === 'ATTENTION' ? ['PENDING', 'PROCESSING', 'UNCERTAIN', 'FAILED'].includes(row.status) : row.status === status));
      return page(mapped, query);
    }
    if (section === 'messages') {
      const inboundWhere: Prisma.MessageWhereInput = { ...(text(query.leaseId) ? { leaseId: text(query.leaseId) } : {}), ...(search ? { OR: [{ sender: { contains: search, mode: 'insensitive' } }, { body: { contains: search, mode: 'insensitive' } }, { lease: { user: { email: { contains: search, mode: 'insensitive' } } } }] } : {}) };
      const outboundWhere: Prisma.OutboundMessageWhereInput = { ...(text(query.leaseId) ? { leaseId: text(query.leaseId) } : {}), ...(search ? { OR: [{ to: { contains: search, mode: 'insensitive' } }, { content: { contains: search, mode: 'insensitive' } }, { lease: { user: { email: { contains: search, mode: 'insensitive' } } } }] } : {}) };
      const [inbound, outbound] = await Promise.all([
        this.db.message.findMany({ where: inboundWhere, include: { lease: { include: { user: true, phoneNumber: true } } } }),
        this.db.outboundMessage.findMany({ where: outboundWhere, include: { lease: { include: { user: true, phoneNumber: true } } } }),
      ]);
      const mapped = [...inbound.map(row => this.mapInbound(row)), ...outbound.map(row => this.mapOutbound(row))].filter(row => (!text(query.direction) || row.direction === query.direction) && (!status || row.direction === 'OUTBOUND' && row.status === status)).sort((a, b) => b.at.localeCompare(a.at));
      return page(mapped, query);
    }
    if (section === 'webhooks') {
      const where: Prisma.WebhookEventWhereInput = search ? { OR: [{ eventId: { contains: search, mode: 'insensitive' } }, { providerNumberId: { contains: search, mode: 'insensitive' } }, { providerMessageId: { contains: search, mode: 'insensitive' } }, { providerAccountId: { contains: search, mode: 'insensitive' } }] } : {};
      if (status) where.status = status;
      if (text(query.provider) === 'demo') where.provider = { startsWith: 'demo-inbox:' }; else if (text(query.provider)) where.provider = text(query.provider);
      if (text(query.eventType)) where.payload = { path: ['event'], equals: text(query.eventType) };
      for (const field of ['from', 'to']) if (query[field] && (typeof query[field] !== 'string' || !Number.isFinite(Date.parse(String(query[field]))))) throw errorWithCode('日期格式不正确。', 'VALIDATION_ERROR', 400);
      if (query.from || query.to) where.receivedAt = { ...(query.from ? { gte: new Date(String(query.from)) } : {}), ...(query.to ? { lte: new Date(String(query.to)) } : {}) };
      if (query.from && query.to && Date.parse(String(query.from)) > Date.parse(String(query.to))) throw errorWithCode('开始时间须早于结束时间。', 'VALIDATION_ERROR', 400);
      const pageSize = [10, 20, 50].includes(Number(query.pageSize)) ? Number(query.pageSize) : 20;
      const totalItems = await this.db.webhookEvent.count({ where }), totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const current = Math.min(Math.max(1, Number.isSafeInteger(Number(query.page)) ? Number(query.page) : 1), totalPages);
      const rows = await this.db.webhookEvent.findMany({ where, orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }], skip: (current - 1) * pageSize, take: pageSize });
      return { items: rows.map(row => this.mapWebhook(row, false)), page: current, pageSize, totalItems, totalPages };
    }
    if (section === 'audit') {
      const where: Prisma.AuditLogWhereInput = search ? { OR: [{ resourceId: { contains: search, mode: 'insensitive' } }, { reason: { contains: search, mode: 'insensitive' } }, { user: { email: { contains: search, mode: 'insensitive' } } }] } : {};
      where.action = { in: adminActions, ...(status ? { equals: status } : {}) };
      const rows = await this.db.auditLog.findMany({ where, include: { user: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
      return page(rows.map(row => ({ id: row.id, actorEmail: row.user.email, action: row.action, targetType: row.targetType || actionTarget(row.action), targetId: row.resourceId, reason: row.reason || '', createdAt: row.createdAt.toISOString() })), query);
    }
    throw notFound('管理列表不存在。');
  }

  async summary() {
    const now = new Date(), today = new Date(Math.floor((now.getTime() + 8 * 3600000) / day) * day - 8 * 3600000), soon = new Date(now.getTime() + 3 * day);
    const [users, activeLeases, availableNumbers, heldNumbers, todayOrders, failedOutbound, failedWebhooks, uncertainOrders, recent, expiring] = await Promise.all([
      this.db.user.count(), this.db.lease.count({ where: { status: 'ACTIVE', expiresAt: { gt: now } } }),
      this.db.phoneNumber.count({ where: { occupied: false, holdReason: null } }), this.db.phoneNumber.count({ where: { occupied: false, holdReason: { not: null } } }),
      this.db.order.findMany({ where: { createdAt: { gte: today } }, include: { user: true, lease: { include: { phoneNumber: true } }, phoneNumber: true }, orderBy: { createdAt: 'desc' } }),
      this.db.outboundMessage.count({ where: { status: { in: ['FAILED', 'UNCERTAIN'] } } }), this.db.webhookEvent.count({ where: { status: { in: ['FAILED', 'UNMATCHED', 'QUARANTINED'] } } }),
      this.db.order.count({ where: { status: { in: ['PENDING', 'PROCESSING', 'UNCERTAIN', 'FAILED'] } } }),
      this.db.order.findMany({ include: { user: true, lease: { include: { phoneNumber: true } }, phoneNumber: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 6 }),
      this.db.lease.findMany({ where: { status: 'ACTIVE', expiresAt: { gt: now, lte: soon } }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } }, orderBy: { expiresAt: 'asc' }, take: 6 }),
    ]);
    const cash = await this.db.paymentReceipt.aggregate({ where: { paidAt: { gte: today }, recharge: { environment: 'LIVE' } }, _sum: { amountMinor: true } });
    const revenue = cash._sum.amountMinor ?? 0;
    const [expiredHeldNumbers, stock] = await Promise.all([this.db.lease.count({ where: { status: 'EXPIRED_HELD' } }), this.numberStats()]);
    const lowStock = stock.filter(region => region.available <= lowStockThreshold).map(({ countryCode, regionId, regionName, available }) => ({ countryCode, regionId, regionName, available }));
    return { users, activeLeases, availableNumbers, heldNumbers, expiredHeldNumbers, lowStock, lowStockThreshold, todayOrders: todayOrders.length, todayRevenueMinor: revenue, currency: 'USD',
      expiringLeases: await this.db.lease.count({ where: { status: 'ACTIVE', expiresAt: { gt: now, lte: soon } } }), failedOutbound, failedWebhooks, uncertainOrders,
      recentOrders: recent.map(row => this.mapOrder(row)), expiring: expiring.map(row => this.mapLease(row)),
      integrations: { demoMode: settings.demo, pingcodeConfigured: pcConfigured(), receiveWebhookConfigured: Boolean(settings.pingcode.accountId && settings.pingcode.receiveWebhookSecret), paymentsConnected: false } };
  }

  async detail(section: 'users' | 'numbers' | 'leases' | 'orders', id: string) {
    if (section === 'users') {
      const user = await this.db.user.findUnique({ where: { id }, include: { _count: { select: { leases: true, orders: true } }, leases: { select: { status: true, expiresAt: true } } } });
      if (!user) throw notFound();
      const [leases, orders] = await Promise.all([
        this.db.lease.findMany({ where: { userId: id }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } }, orderBy: { startedAt: 'desc' } }),
        this.db.order.findMany({ where: { userId: id }, include: { user: true, lease: { include: { phoneNumber: true } }, phoneNumber: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      ]);
      return { user: this.mapUser(user), leases: leases.map(row => this.mapLease(row)), orders: orders.map(row => this.mapOrder(row)) };
    }
    if (section === 'numbers') {
      const row = await this.db.phoneNumber.findUnique({ where: { id }, include: { leases: { include: { user: true }, orderBy: { startedAt: 'desc' } } } });
      if (!row) throw notFound();
      return { number: this.mapNumber(row, await cooldownDays(this.db)), leases: row.leases.map(lease => this.mapLease({ ...lease, phoneNumber: row, _count: { messages: 0, outbound: 0 } })) };
    }
    if (section === 'leases') {
      const lease = await this.db.lease.findUnique({ where: { id }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } } });
      if (!lease) throw notFound();
      const [orders, inbound, outbound] = await Promise.all([
        this.db.order.findMany({ where: { leaseId: id }, include: { user: true, lease: { include: { phoneNumber: true } }, phoneNumber: true }, orderBy: { createdAt: 'desc' } }),
        this.db.message.findMany({ where: { leaseId: id }, include: { lease: { include: { user: true, phoneNumber: true } } } }),
        this.db.outboundMessage.findMany({ where: { leaseId: id }, include: { lease: { include: { user: true, phoneNumber: true } } } }),
      ]);
      const messages = [...inbound.map(row => this.mapInbound(row)), ...outbound.map(row => this.mapOutbound(row))].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
      return { lease: this.mapLease(lease), orders: orders.map(row => this.mapOrder(row)), messages };
    }
    const order = await this.db.order.findUnique({ where: { id }, include: { user: true, lease: { include: { phoneNumber: true } }, phoneNumber: true } });
    if (!order) throw notFound();
    return this.mapOrder(order);
  }

  async userStatus(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'USER_STATUS', async (tx, reason) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw notFound();
      if (user.role === 'ADMIN') throw errorWithCode('不能对管理员账号执行此操作。', 'ADMIN_PROTECTED');
      const status = body.status === 'ACTIVE' || body.status === 'DISABLED' ? body.status : '';
      if (!status) throw errorWithCode('用户状态无效。', 'VALIDATION_ERROR', 400);
      await tx.user.update({ where: { id }, data: { status } });
      if (status === 'DISABLED') await tx.session.deleteMany({ where: { userId: id } });
      return { value: await this.userView(tx, id), targetId: id };
    });
  }
  async resetPassword(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'USER_PASSWORD_RESET', async tx => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw notFound();
      if (user.role === 'ADMIN') throw errorWithCode('不能对管理员账号执行此操作。', 'ADMIN_PROTECTED');
      const next = typeof body.newPassword === 'string' ? body.newPassword : '';
      if (next.length < 12 || next.length > 128) throw errorWithCode('新密码需要 12–128 个字符。', 'VALIDATION_ERROR', 400);
      await tx.user.update({ where: { id }, data: { passwordHash: await passwordHash(next) } });
      await tx.session.deleteMany({ where: { userId: id } });
      return { value: { ok: true } as const, targetId: id };
    });
  }
  async assignNumber(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'NUMBER_ASSIGN', async (tx, reason, operationKey) => {
      const userId = text(body.userId);
      if (!uuid.test(userId)) throw errorWithCode('目标用户无效。', 'VALIDATION_ERROR', 400);
      await lockUser(tx, userId);
      await lockPhone(tx, id);
      const [number, user] = await Promise.all([tx.phoneNumber.findUnique({ where: { id } }), tx.user.findUnique({ where: { id: userId } })]);
      if (!number) throw notFound();
      if (!user || user.status !== 'ACTIVE' || user.role !== 'USER') throw errorWithCode('目标用户不存在或已禁用。', 'USER_UNAVAILABLE');
      if (number.occupied || number.holdReason) throw errorWithCode('号码已被占用或已暂停，请刷新后重试。', 'NUMBER_UNAVAILABLE');
      // Manual assignment is a free, audited compensation. Paid purchases must use the points ledger.
      const plan = await planFor(tx, Number(body.term), false);
      const amountMinor = amountInput(body.amountMinor), note = text(body.note).slice(0, 200);
      if (amountMinor !== 0) throw errorWithCode('手动开通仅限免费补偿；收费购买请使用积分。', 'POINTS_REQUIRED');
      const startedAt = new Date(), expiresAt = new Date(startedAt.getTime() + plan.days * day);
      const lease = await tx.lease.create({ data: { userId, phoneNumberId: id, termDays: plan.days, priceMinor: amountMinor, currency: plan.currency, status: 'ACTIVE', startedAt, expiresAt } });
      await tx.phoneNumber.update({ where: { id }, data: { occupied: true, holdReason: null } });
      await tx.order.create({ data: { userId, leaseId: lease.id, phoneNumberId: id, numberSnapshot: number.number, kind: 'ADMIN_ASSIGN', settlementType: 'COMPENSATION', termDays: plan.days, amountMinor, currency: plan.currency, status: 'COMPLETED', completedAt: startedAt,
        evidence: note ? { adminNote: note } : undefined, idempotencyKey: operationKey, requestHash: fingerprint({ operationKey, id, userId, term: plan.days, amountMinor }) } });
      const result = await tx.lease.findUniqueOrThrow({ where: { id: lease.id }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } } });
      return { value: this.mapLease(result), targetId: id };
    });
  }
  async holdNumber(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'NUMBER_HOLD', async tx => {
      await lockPhone(tx, id);
      const number = await tx.phoneNumber.findUnique({ where: { id }, include: { leases: { include: { user: true } } } });
      if (!number) throw notFound();
      if (number.occupied) throw errorWithCode('号码已被占用或已暂停，请刷新后重试。', 'NUMBER_UNAVAILABLE');
      if (typeof body.hold !== 'boolean') throw errorWithCode('hold 必须是布尔值。', 'VALIDATION_ERROR', 400);
      await tx.phoneNumber.update({ where: { id }, data: body.hold ? { holdReason: text(body.reason) } : { holdReason: null } });
      const current = await tx.phoneNumber.findUniqueOrThrow({ where: { id }, include: { leases: { include: { user: true } } } });
      return { value: this.mapNumber(current, await cooldownDays(tx)), targetId: id };
    });
  }
  async endLease(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'LEASE_END', async tx => {
      const current = await tx.lease.findUnique({ where: { id }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } } });
      if (!current) throw notFound();
      if (current.status !== 'ACTIVE' || current.expiresAt.getTime() <= Date.now()) throw errorWithCode('租约已结束或已变化，请刷新后重试。', 'LEASE_NOT_ACTIVE');
      await lockPhone(tx, current.phoneNumberId);
      const endedAt = new Date();
      const lease = await tx.lease.update({ where: { id }, data: { status: 'ENDED', endedAt }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } } });
      await tx.phoneNumber.update({ where: { id: current.phoneNumberId }, data: { occupied: false, holdReason: '管理员回收，待人工复核' } });
      return { value: this.mapLease(lease), targetId: id };
    });
  }
  async extendLease(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'LEASE_EXTEND', async (tx, reason, operationKey) => {
      const current = await tx.lease.findUnique({ where: { id }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } } });
      if (!current) throw notFound();
      if (current.status !== 'ACTIVE' || current.expiresAt.getTime() <= Date.now()) throw errorWithCode('租约已结束或已变化，请刷新后重试。', 'LEASE_NOT_ACTIVE');
      if (!Number.isInteger(body.days) || Number(body.days) < 1 || Number(body.days) > 365) throw errorWithCode('延期天数需要是 1–365 的整数。', 'VALIDATION_ERROR', 400);
      const amountMinor = amountInput(body.amountMinor), note = text(body.note).slice(0, 200);
      if (amountMinor !== 0) throw errorWithCode('手动延期仅限免费补偿；收费续租请使用积分。', 'POINTS_REQUIRED');
      await lockPhone(tx, current.phoneNumberId);
      const expiresAt = new Date(current.expiresAt.getTime() + Number(body.days) * day);
      const lease = await tx.lease.update({ where: { id }, data: { expiresAt }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } } });
      await tx.order.create({ data: { userId: lease.userId, leaseId: id, phoneNumberId: lease.phoneNumberId, numberSnapshot: lease.phoneNumber.number, kind: 'ADMIN_EXTEND', settlementType: 'COMPENSATION', termDays: Number(body.days), amountMinor, currency: lease.currency, status: 'COMPLETED', completedAt: new Date(),
        evidence: note ? { adminNote: note } : undefined, idempotencyKey: operationKey, requestHash: fingerprint({ operationKey, id, days: body.days, amountMinor }) } });
      return { value: this.mapLease(lease), targetId: id };
    });
  }

  // ---- Plans -------------------------------------------------------------------------------------
  private mapPlan(row: Prisma.PlanGetPayload<{}>, counts: Map<number, number>) {
    return { id: row.id, days: row.days, priceMinor: row.priceMinor, pointsPrice: row.pointsPrice, version: row.version, currency: row.currency, label: row.label, note: row.note,
      active: row.active, sortOrder: row.sortOrder, orderCount: counts.get(row.days) ?? 0, updatedAt: row.updatedAt.toISOString() };
  }
  private async planCounts(db: Tx | DbService) {
    const groups = await db.order.groupBy({ by: ['termDays'], where: { kind: { in: ['RENT', 'ADMIN_ASSIGN'] } }, _count: { _all: true } });
    return new Map(groups.map(group => [group.termDays, group._count._all]));
  }
  async plans() {
    const [rows, counts] = await Promise.all([this.db.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { days: 'asc' }] }), this.planCounts(this.db)]);
    return rows.map(row => this.mapPlan(row, counts));
  }
  private planFields(body: WriteInput) {
    const priceMinor = body.priceMinor, label = text(body.label), note = text(body.note), sortOrder = body.sortOrder ?? 0;
    if (!Number.isInteger(priceMinor) || Number(priceMinor) <= 0 || Number(priceMinor) > 100000000) throw errorWithCode('价格无效。', 'VALIDATION_ERROR', 400);
    if (!label || label.length > 20) throw errorWithCode('套餐名称需要 1–20 个字符。', 'VALIDATION_ERROR', 400);
    if (note.length > 60) throw errorWithCode('说明不能超过 60 个字符。', 'VALIDATION_ERROR', 400);
    if (!Number.isInteger(sortOrder) || Math.abs(Number(sortOrder)) > 10000) throw errorWithCode('排序值无效。', 'VALIDATION_ERROR', 400);
    if (typeof body.active !== 'boolean') throw errorWithCode('请选择是否上架。', 'VALIDATION_ERROR', 400);
    return { priceMinor: Number(priceMinor), pointsPrice: Number(priceMinor), label, note, sortOrder: Number(sortOrder), active: body.active };
  }
  async createPlan(actorId: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'PLAN_CREATE', async tx => {
      const days = body.days;
      if (!Number.isInteger(days) || Number(days) < 1 || Number(days) > 365) throw errorWithCode('天数需要是 1–365 的整数。', 'VALIDATION_ERROR', 400);
      if (await tx.plan.findUnique({ where: { days: Number(days) } })) throw errorWithCode('已有相同天数的套餐，请直接编辑它。', 'PLAN_EXISTS');
      const row = await tx.plan.create({ data: { days: Number(days), currency: 'USD', ...this.planFields(body) } });
      return { value: this.mapPlan(row, await this.planCounts(tx)), targetId: row.id };
    });
  }
  async updatePlan(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'PLAN_UPDATE', async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin:plans',0))`;
      const current = await tx.plan.findUnique({ where: { id } });
      if (!current) throw notFound();
      const fields = this.planFields(body);
      if (current.active && !fields.active && await tx.plan.count({ where: { active: true, id: { not: id } } }) === 0)
        throw errorWithCode('至少要保留一个上架的套餐，否则用户将无法购买。', 'LAST_ACTIVE_PLAN');
      // Existing leases and orders keep the price they were sold at; only new purchases use the change.
      const row = await tx.plan.update({ where: { id }, data: { ...fields, version: { increment: 1 } } });
      return { value: this.mapPlan(row, await this.planCounts(tx)), targetId: id };
    });
  }

  // ---- Settings ----------------------------------------------------------------------------------
  async settings() {
    return { cooldownDays: await cooldownDays(this.db) };
  }
  async updateSettings(actorId: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'SETTINGS_UPDATE', async tx => {
      const value = body.cooldownDays;
      if (value !== null && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 365)) throw errorWithCode('保留天数需要是 0–365 的整数，或留空表示不自动释放。', 'VALIDATION_ERROR', 400);
      await tx.appSetting.upsert({ where: { key: cooldownKey }, create: { key: cooldownKey, value: value as Prisma.InputJsonValue ?? Prisma.JsonNull }, update: { value: value as Prisma.InputJsonValue ?? Prisma.JsonNull } });
      return { value: { cooldownDays: value === null ? null : Number(value) }, targetId: cooldownKey };
    });
  }

  // ---- Number inventory --------------------------------------------------------------------------
  /** Sellable, occupied and held counts per region, smallest stock first. */
  async numberStats() {
    const rows = await this.db.phoneNumber.findMany({ select: { countryCode: true, regionId: true, regionName: true, occupied: true, holdReason: true } });
    const regions = new Map<string, { countryCode: string; regionId: string; regionName: string; total: number; available: number; occupied: number; held: number }>();
    for (const row of rows) {
      const key = `${row.countryCode}:${row.regionId}`;
      const region = regions.get(key) ?? { countryCode: row.countryCode, regionId: row.regionId, regionName: row.regionName, total: 0, available: 0, occupied: 0, held: 0 };
      region.total++;
      if (row.occupied) region.occupied++; else if (row.holdReason) region.held++; else region.available++;
      regions.set(key, region);
    }
    return [...regions.values()].sort((a, b) => a.available - b.available || a.regionName.localeCompare(b.regionName, 'zh-CN'));
  }
  async createNumber(actorId: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'NUMBER_CREATE', async tx => {
      const input = numberInput(body);
      if (typeof input === 'string') throw errorWithCode(input, 'VALIDATION_ERROR', 400);
      if (await tx.phoneNumber.findUnique({ where: { number: input.number } })) throw errorWithCode(`号码 ${input.number} 已在库存中。`, 'NUMBER_EXISTS');
      const row = await tx.phoneNumber.create({ data: { ...input, provider: 'demo', source: 'ADMIN' }, include: { leases: { include: { user: true } } } });
      return { value: this.mapNumber(row, await cooldownDays(tx)), targetId: row.id };
    });
  }
  /** Checks a CSV import without writing. Rows are numbered from 1 as the operator sees them. */
  async previewImport(body: WriteInput) {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) throw errorWithCode('没有可导入的行。', 'VALIDATION_ERROR', 400);
    if (rows.length > 1000) throw errorWithCode('一次最多导入 1000 个号码。', 'VALIDATION_ERROR', 400);
    const parsed = rows.map((row, index) => ({ line: index + 1, input: row && typeof row === 'object' ? numberInput(row as Record<string, unknown>) : '格式不正确。' }));
    const numbers = parsed.flatMap(row => typeof row.input === 'string' ? [] : [row.input.number]);
    const existing = new Set((await this.db.phoneNumber.findMany({ where: { number: { in: numbers } }, select: { number: true } })).map(row => row.number));
    const seen = new Set<string>(), valid: NumberInput[] = [], errors: { line: number; message: string }[] = [];
    for (const row of parsed) {
      if (typeof row.input === 'string') errors.push({ line: row.line, message: row.input });
      else if (existing.has(row.input.number)) errors.push({ line: row.line, message: `${row.input.number} 已在库存中。` });
      else if (seen.has(row.input.number)) errors.push({ line: row.line, message: `${row.input.number} 在文件中重复。` });
      else { seen.add(row.input.number); valid.push(row.input); }
    }
    return { valid, errors };
  }
  async importNumbers(actorId: string, body: WriteInput, key: unknown) {
    const preview = await this.previewImport(body);
    if (preview.errors.length) throw new BadRequestException({ message: `有 ${preview.errors.length} 行需要修正，请重新预览。`, code: 'IMPORT_INVALID', errors: preview.errors });
    return this.recordMutation(actorId, key, body, 'NUMBER_CREATE', async tx => {
      // Re-checked inside the transaction so a concurrent import cannot insert the same number twice.
      const clash = await tx.phoneNumber.count({ where: { number: { in: preview.valid.map(row => row.number) } } });
      if (clash) throw errorWithCode('部分号码刚刚被其他操作加入库存，请重新预览。', 'NUMBER_EXISTS');
      const created = await tx.phoneNumber.createManyAndReturn({ data: preview.valid.map(row => ({ ...row, provider: 'demo', source: 'ADMIN' })), select: { id: true } });
      return { value: { created: created.length }, targetId: 'import', audits: created.map(row => ({ action: 'NUMBER_CREATE', targetId: row.id })) };
    });
  }
  async updateNumber(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'NUMBER_UPDATE', async tx => {
      await lockPhone(tx, id);
      const current = await tx.phoneNumber.findUnique({ where: { id } });
      if (!current) throw notFound();
      // The number itself is the record's identity and stays fixed; region and note can be corrected.
      const input = numberInput({ ...body, number: current.number });
      if (typeof input === 'string') throw errorWithCode(input, 'VALIDATION_ERROR', 400);
      const { number: _number, ...fields } = input;
      const row = await tx.phoneNumber.update({ where: { id }, data: fields, include: { leases: { include: { user: true } } } });
      return { value: this.mapNumber(row, await cooldownDays(tx)), targetId: id };
    });
  }
  async deleteNumber(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'NUMBER_DELETE', async tx => {
      await lockPhone(tx, id);
      const row = await tx.phoneNumber.findUnique({ where: { id }, include: { _count: { select: { leases: true, orders: true } } } });
      if (!row) throw notFound();
      if (row.occupied || row._count.leases || row._count.orders) throw errorWithCode('这个号码已有租用或订单记录，不能删除，可以改为暂停售卖。', 'NUMBER_IN_USE');
      await tx.phoneNumber.delete({ where: { id } });
      return { value: { id, number: row.number }, targetId: id };
    });
  }
  /** Releases (back to sale) or holds several numbers; numbers that cannot change are reported, not failed. */
  async batchNumbers(actorId: string, body: WriteInput, key: unknown) {
    const action = body.action === 'release' || body.action === 'hold' ? body.action : null;
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === 'string' && uuid.test(id)))] : [];
    if (!action) throw errorWithCode('操作类型无效。', 'VALIDATION_ERROR', 400);
    if (!ids.length || ids.length > 200) throw errorWithCode('请选择 1–200 个号码。', 'VALIDATION_ERROR', 400);
    return this.recordMutation(actorId, key, body, action === 'release' ? 'NUMBER_RELEASE' : 'NUMBER_HOLD', async (tx, reason) => {
      const changed: string[] = [], skipped: { id: string; number: string; message: string }[] = [];
      for (const id of [...ids].sort()) {
        await lockPhone(tx, id);
        const row = await tx.phoneNumber.findUnique({ where: { id } });
        if (!row) { skipped.push({ id, number: '', message: '号码不存在。' }); continue; }
        if (action === 'release') {
          if (!row.occupied && !row.holdReason) skipped.push({ id, number: row.number, message: '已经是可售状态。' });
          else if (await releaseNumber(tx, id)) changed.push(id);
          else skipped.push({ id, number: row.number, message: '号码正在使用中或有未完成订单。' });
        } else if (row.occupied || row.holdReason) skipped.push({ id, number: row.number, message: row.occupied ? '号码正在使用或到期保留中。' : '已经是暂停状态。' });
        else { await tx.phoneNumber.update({ where: { id }, data: { holdReason: reason } }); changed.push(id); }
      }
      return { value: { changed: changed.length, skipped }, targetId: 'batch', audits: changed.map(targetId => ({ action: action === 'release' ? 'NUMBER_RELEASE' : 'NUMBER_HOLD', targetId })) };
    });
  }

  async retryWebhook(actorId: string, id: string, body: WriteInput, key: unknown) {
    const requestKey = validateKey(key), reason = validateReason(body), requestHash = fingerprint({ actorId, action: 'WEBHOOK_RETRY', id, body });
    const claim = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'admin:idempotency:' + requestKey},0))`;
      const previous = await tx.adminIdempotency.findUnique({ where: { key: requestKey } });
      if (previous) {
        if (previous.actorId !== actorId || previous.requestHash !== requestHash) throw errorWithCode('操作标识已用于其他请求。', 'IDEMPOTENCY_CONFLICT');
        if (previous.result === null) throw errorWithCode('该操作正在处理中，请刷新核对事件状态。', 'IDEMPOTENCY_IN_PROGRESS');
        return { replay: previous.result, event: null };
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'admin:webhook:' + id},0))`;
      const event = await tx.webhookEvent.findUnique({ where: { id } });
      if (!event) throw notFound();
      if (!this.mapWebhook(event).retryable) throw errorWithCode('该事件已处理、正在处理，或不属于当前接入账号。', 'WEBHOOK_NOT_RETRYABLE');
      await tx.webhookEvent.update({ where: { id }, data: { status: 'PROCESSING', nextAttemptAt: new Date(Date.now() + 120000) } });
      await tx.adminIdempotency.create({ data: { key: requestKey, actorId, requestHash } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'WEBHOOK_RETRY', resourceId: id, targetType: 'webhook', reason } });
      return { replay: null, event };
    }, transactionOptions);
    if (claim.replay !== null) return claim.replay;
    const event = claim.event!;
    try {
      const payload = event.payload as { event?: string };
      if (event.provider === 'pingcode') {
        if (payload.event === 'sms.send.status_changed') await this.outbound.processReceipt(id, 'ADMIN');
        else await this.incoming.process(id, 'ADMIN');
      } else {
        const lease = event.leaseId ? await this.db.lease.findUnique({ where: { id: event.leaseId } }) : null;
        if (!lease) throw notFound();
        await this.events.process(lease.userId, id, 'ADMIN');
      }
    } catch {
      // Keep the failed outcome visible instead of losing the audit or re-running on a network retry.
      await this.db.webhookEvent.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'FAILED',
        lastError: 'ADMIN_RETRY_FAILED', attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 30000) } });
    }
    const value = this.mapWebhook(await this.db.webhookEvent.findUniqueOrThrow({ where: { id } }));
    await this.db.adminIdempotency.update({ where: { key: requestKey }, data: { result: value as unknown as Prisma.InputJsonValue } });
    return value;
  }
}

function actionTarget(action: string) {
  if (action.startsWith('INTEGRATION_')) return 'integration';
  if (action.startsWith('USER_') || action === 'ADMIN_BOOTSTRAP') return 'user';
  if (action.startsWith('NUMBER_')) return 'number';
  if (action.startsWith('LEASE_')) return 'lease';
  if (action.startsWith('PLAN_')) return 'plan';
  if (action.startsWith('SETTINGS_')) return 'settings';
  return 'webhook';
}
function orderNote(evidence: Prisma.JsonValue | null) {
  return evidence && typeof evidence === 'object' && !Array.isArray(evidence) && typeof evidence.adminNote === 'string' ? evidence.adminNote : null;
}
const adminActions = ['INTEGRATION_CONFIG_UPDATED', 'INTEGRATION_CHECK', 'INTEGRATION_SYNC', 'USER_STATUS', 'USER_PASSWORD_RESET', 'NUMBER_ASSIGN', 'NUMBER_HOLD', 'NUMBER_RELEASE', 'NUMBER_CREATE', 'NUMBER_UPDATE',
  'NUMBER_DELETE', 'LEASE_END', 'LEASE_EXTEND', 'PLAN_CREATE', 'PLAN_UPDATE', 'SETTINGS_UPDATE', 'WEBHOOK_RETRY', 'ADMIN_BOOTSTRAP', 'POINTS_REFUND_APPROVED', 'POINTS_REFUND_REJECTED', 'POINTS_COMPENSATION_ADJUSTED',
  'ORDER_POINTS_REFUNDED', 'POINTS_RULES_UPDATED', 'POINTS_RECONCILED', 'UNCREDITED_RETURN_REQUESTED', 'POINTS_EXCEPTION_RESOLVED'];
