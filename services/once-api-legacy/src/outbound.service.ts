import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { OutboundMessage, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DbService } from './db.service';
import { cursorPosition, fingerprint, lockPhone, lockUser, pageResult, transactionOptions } from './business';
import { normalizePhone, PcError, PcStatus, PingcodeClient, pcConfigured, smsCapability } from './pingcode.client';
import { settings } from './config';
import { safeErrorDetails } from './error-summary';
import { traceWebhook } from './webhook-trace';

export type SendReceipt = {
  eventId: string; event: 'sms.send.status_changed'; occurredAt: string;
  data: {messageId: string; senderNumberId: number; senderPhoneNumber: string; recipient: string; status: PcStatus; errorCode?: string | null};
};
const terminal = ['DELIVERED', 'UNDELIVERABLE', 'FAILED'];
export function outboundView(row: OutboundMessage) {
  return {id: row.id, leaseId: row.leaseId, number: row.from, to: row.to, content: row.content,
    status: row.status, errorCode: row.lastError, createdAt: row.createdAt, updatedAt: row.updatedAt,
    providerMessageId: row.providerMessageId, demo: row.provider === 'demo'};
}
function statusChange(row: OutboundMessage, status: PcStatus, errorCode?: string | null, occurredAt?: Date): Prisma.OutboundMessageUpdateInput {
  if (terminal.includes(row.status)) return {};
  if (occurredAt && row.lastEventAt && occurredAt < row.lastEventAt) return {};
  if (row.providerStatus === 'SENT' && ['QUEUED', 'SENDING', 'UNCERTAIN'].includes(status)) return {};
  if (row.providerStatus === 'SENDING' && status === 'QUEUED') return {};
  return {status, providerStatus: status, lastError: errorCode || null, ...(occurredAt ? {lastEventAt: occurredAt} : {})};
}

@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);
  constructor(private readonly db: DbService, private readonly pc: PingcodeClient) {}
  private async owned(userId: string, leaseId: string) {
    const lease = await this.db.lease.findFirst({where: {id: leaseId, userId}, include: {phoneNumber: true}});
    if (!lease) throw new NotFoundException('Lease not found');
    return lease;
  }
  async send(userId: string, leaseId: string, to: string, content: string, key: unknown) {
    if (typeof key !== 'string' || !/^[\x21-\x7e]{1,120}$/.test(key)) throw new BadRequestException('A 1-120 character Idempotency-Key is required');
    const recipient = to.replace(/[\s()-]/g, '');
    if (!/^\+[1-9]\d{1,14}$/.test(recipient) || !content.trim() || content.length > 4000) throw new BadRequestException('Invalid recipient or SMS content');
    const hash = fingerprint({leaseId, to: normalizePhone(recipient), content});
    const saved = await this.db.$transaction(async tx => {
      await lockUser(tx, userId);
      const reference = await tx.lease.findFirst({where: {id: leaseId, userId}});
      if (!reference) throw new NotFoundException('Lease not found');
      await lockPhone(tx, reference.phoneNumberId);
      const previous = await tx.outboundMessage.findUnique({where: {leaseId_idempotencyKey: {leaseId, idempotencyKey: key}}});
      if (previous) {
        if (previous.requestHash !== hash) throw new ConflictException('Idempotency key was already used for a different SMS');
        return previous;
      }
      const lease = await tx.lease.findUniqueOrThrow({where: {id: leaseId}, include: {phoneNumber: true}});
      const capability = smsCapability(lease);
      if (!capability.enabled) {
        if (capability.reason === '短信发送服务尚未配置') throw new ServiceUnavailableException(capability.reason);
        throw new ConflictException(capability.reason!);
      }
      const row = await tx.outboundMessage.create({data: {leaseId, from: lease.phoneNumber.number, to: recipient, content,
        provider: lease.phoneNumber.provider, providerAccountId: lease.phoneNumber.providerAccountId, idempotencyKey: key, requestHash: hash}});
      await tx.auditLog.create({data: {userId, action: 'SMS_SEND_CREATED', resourceId: row.id, details: {leaseId, demo: capability.demo}}});
      return row;
    }, transactionOptions);
    return outboundView(await this.dispatch(saved.id));
  }
  private async dispatch(id: string) {
    const reference = await this.db.outboundMessage.findUniqueOrThrow({where: {id}, include: {lease: true}});
    const claimed = await this.db.$transaction(async tx => {
      await lockUser(tx, reference.lease.userId);
      await lockPhone(tx, reference.lease.phoneNumberId);
      const row = await tx.outboundMessage.findUniqueOrThrow({where: {id}});
      if (row.provider !== 'pingcode' || row.providerAccountId !== settings.pingcode.accountId || !pcConfigured()) return {row, token: null, numberId: ''};
      if (terminal.includes(row.status) || row.providerMessageId || (row.claimUntil && row.claimUntil > new Date())) return {row, token: null, numberId: ''};
      if (row.attempts > 0 && row.createdAt.getTime() < Date.now() - (86400000 - 60000)) {
        const expired = await tx.outboundMessage.update({where: {id}, data: {status: 'UNCERTAIN',
          lastError: 'IDEMPOTENCY_RETRY_WINDOW_EXPIRED', claimToken: null, claimUntil: null, lastCheckedAt: new Date()}});
        return {row: expired, token: null, numberId: ''};
      }
      const lease = await tx.lease.findUniqueOrThrow({where: {id: row.leaseId}, include: {phoneNumber: true}});
      const capability = smsCapability(lease);
      const sameSender = row.provider === lease.phoneNumber.provider && row.providerAccountId === lease.phoneNumber.providerAccountId &&
        normalizePhone(row.from) === normalizePhone(lease.phoneNumber.number);
      if (!capability.enabled || !sameSender) {
        const updated = await tx.outboundMessage.update({where: {id}, data: {status: row.attempts ? 'UNCERTAIN' : 'FAILED',
          lastError: !sameSender ? 'OUTBOUND_SENDER_IDENTITY_MISMATCH' : row.attempts ? 'LEASE_OR_PROVIDER_UNAVAILABLE_FOR_RETRY' : capability.reason, claimToken: null, claimUntil: null, lastCheckedAt: new Date()}});
        return {row: updated, token: null, numberId: ''};
      }
      const token = randomUUID();
      return {row: await tx.outboundMessage.update({where: {id}, data: {status: 'SUBMITTING', claimToken: token,
        claimUntil: new Date(Date.now() + 15000), attempts: {increment: 1}, lastCheckedAt: new Date()}}), token, numberId: lease.phoneNumber.providerNumberId || ''};
    }, transactionOptions);
    if (!claimed.token) return claimed.row;
    try {
      const result = await this.pc.send(id, {...claimed.row, numberId: claimed.numberId});
      const saved = await this.db.$transaction(async tx => {
        await lockUser(tx, reference.lease.userId);
        await lockPhone(tx, reference.lease.phoneNumberId);
        const row = await tx.outboundMessage.findUniqueOrThrow({where: {id}});
        if (row.claimToken !== claimed.token) return row;
        const updated = await tx.outboundMessage.update({where: {id}, data: {...statusChange(row, result.status, result.errorCode),
          providerMessageId: result.id, claimToken: null, claimUntil: null, lastCheckedAt: new Date()}});
        await tx.auditLog.create({data: {userId: reference.lease.userId, action: 'SMS_SEND_SUBMITTED', resourceId: id,
          details: {status: updated.status, providerMessageId: result.id}}});
        return updated;
      }, transactionOptions);
      if (saved.provider === 'pingcode') {
        const waiting = await this.db.webhookEvent.findMany({where: {provider: 'pingcode', providerAccountId: saved.providerAccountId,
          providerMessageId: saved.providerMessageId, status: {in: ['RECEIVED', 'UNMATCHED', 'FAILED']}}, take: 50, orderBy: {occurredAt: 'asc'}});
        for (const event of waiting) if ((event.payload as unknown as SendReceipt).event === 'sms.send.status_changed') await this.processReceipt(event.id);
      }
      return await this.db.outboundMessage.findUniqueOrThrow({where: {id}});
    } catch (error) {
      this.logger.error({ message: 'SMS submission or receipt processing failed', outboundMessageId: id, ...safeErrorDetails(error) });
      const pcError = error instanceof PcError ? error : new PcError('SMS_SUBMISSION_UNCERTAIN');
      await this.db.outboundMessage.updateMany({where: {id, claimToken: claimed.token}, data: {status: pcError.definitive ? 'FAILED' : 'UNCERTAIN',
        lastError: pcError.code, claimToken: null, claimUntil: pcError.retryAfter ? new Date(Date.now() + pcError.retryAfter * 1000) : null, lastCheckedAt: new Date()}});
      return this.db.outboundMessage.findUniqueOrThrow({where: {id}});
    }
  }
  async list(userId: string, leaseId: string, limit: number, cursor?: string) {
    await this.owned(userId, leaseId);
    const scope = `outbound:${userId}:${leaseId}`, position = cursorPosition(cursor, scope);
    const rows = await this.db.outboundMessage.findMany({where: {leaseId, ...(position ? {OR: [{createdAt: {lt: position.time}}, {createdAt: position.time, id: {gt: position.id}}]} : {})},
      orderBy: [{createdAt: 'desc'}, {id: 'asc'}], take: limit + 1});
    const result = pageResult(rows, limit, scope, row => row.createdAt);
    return {...result, items: result.items.map(outboundView)};
  }
  async get(userId: string, leaseId: string, id: string) {
    await this.owned(userId, leaseId);
    const row = await this.db.outboundMessage.findFirst({where: {id, leaseId}});
    if (!row) throw new NotFoundException('SMS not found');
    return outboundView(await this.sync(row));
  }
  private async sync(row: OutboundMessage) {
    if (row.provider !== 'pingcode' || row.providerAccountId !== settings.pingcode.accountId || !pcConfigured() ||
        terminal.includes(row.status) || (row.lastCheckedAt && row.lastCheckedAt > new Date(Date.now() - 15000))) return row;
    if (!row.providerMessageId) return this.dispatch(row.id);
    if (row.provider !== 'pingcode' || !pcConfigured() || row.providerAccountId !== settings.pingcode.accountId) return row;
    const lease = await this.db.lease.findUniqueOrThrow({where: {id: row.leaseId}, include: {phoneNumber: true}});
    await this.db.outboundMessage.update({where: {id: row.id}, data: {lastCheckedAt: new Date()}});
    try {
      const result = await this.pc.lookup(row.providerMessageId, {...row, numberId: lease.phoneNumber.providerNumberId!});
      return await this.db.$transaction(async tx => {
        await lockUser(tx, lease.userId);
        await lockPhone(tx, lease.phoneNumberId);
        const current = await tx.outboundMessage.findUniqueOrThrow({where: {id: row.id}});
        const change = statusChange(current, result.status, result.errorCode);
        return Object.keys(change).length ? tx.outboundMessage.update({where: {id: row.id}, data: change}) : current;
      }, transactionOptions);
    } catch (error) {
      this.logger.error({ message: 'SMS status refresh failed; returning last persisted status', outboundMessageId: row.id, ...safeErrorDetails(error) });
      return this.db.outboundMessage.findUniqueOrThrow({where: {id: row.id}});
    }
  }
  async processReceipt(id: string, source = 'AUTO') {
    await traceWebhook(this.db, id, source, async () => {
      try { await this.processReceiptLogged(id); }
      catch (error) {
        await this.db.webhookEvent.updateMany({ where: { id, status: { notIn: ['PROCESSED', 'QUARANTINED'] } },
          data: { status: 'FAILED', attempts: { increment: 1 }, lastError: 'OUTBOUND_PROCESSING_FAILED', nextAttemptAt: new Date(Date.now() + 30000) } });
        throw error;
      }
    });
  }
  private async processReceiptLogged(id: string) {
    const receipt = await this.db.webhookEvent.findUniqueOrThrow({where: {id}});
    if (receipt.provider !== 'pingcode' || receipt.providerAccountId !== settings.pingcode.accountId) return;
    if (['PROCESSED', 'QUARANTINED'].includes(receipt.status)) return;
    const payload = receipt.payload as unknown as SendReceipt;
    if (!receipt.payloadHash || fingerprint(payload) !== receipt.payloadHash || payload.event !== 'sms.send.status_changed') {
      await this.db.webhookEvent.update({where: {id}, data: {status: 'QUARANTINED', lastError: 'INVALID_SEND_RECEIPT', nextAttemptAt: null}});
      return;
    }
    const reference = await this.db.outboundMessage.findUnique({where: {provider_providerAccountId_providerMessageId: {
      provider: receipt.provider, providerAccountId: receipt.providerAccountId, providerMessageId: payload.data.messageId}}, include: {lease: {include: {phoneNumber: true}}}});
    if (!reference) {
      await this.db.webhookEvent.updateMany({where: {id, status: {notIn: ['PROCESSED', 'QUARANTINED']}}, data: {
        status: 'UNMATCHED', attempts: {increment: 1}, lastError: 'OUTBOUND_TASK_NOT_MATCHED', nextAttemptAt: new Date(Date.now() + 30000)}});
      return;
    }
    await this.db.$transaction(async tx => {
      await lockUser(tx, reference.lease.userId);
      await lockPhone(tx, reference.lease.phoneNumberId);
      const event = await tx.webhookEvent.findUniqueOrThrow({where: {id}});
      if (['PROCESSED', 'QUARANTINED'].includes(event.status)) return;
      const row = await tx.outboundMessage.findUniqueOrThrow({where: {id: reference.id}});
      const phone = reference.lease.phoneNumber;
      if (String(payload.data.senderNumberId) !== phone.providerNumberId || normalizePhone(payload.data.senderPhoneNumber) !== normalizePhone(row.from) ||
          normalizePhone(payload.data.recipient) !== normalizePhone(row.to)) {
        await tx.webhookEvent.update({where: {id}, data: {status: 'QUARANTINED', lastError: 'SEND_RECEIPT_IDENTITY_CONFLICT', nextAttemptAt: null}});
        return;
      }
      const changed = statusChange(row, payload.data.status, payload.data.errorCode, new Date(payload.occurredAt));
      if (Object.keys(changed).length) await tx.outboundMessage.update({where: {id: row.id}, data: changed});
      await tx.webhookEvent.update({where: {id}, data: {leaseId: row.leaseId, outboundMessageId: row.id, status: 'PROCESSED',
        attempts: {increment: 1}, processedAt: new Date(), nextAttemptAt: null, lastError: null}});
    }, transactionOptions);
  }
  async recover(limit = 25) {
    if (!pcConfigured()) return;
    const rows = await this.db.outboundMessage.findMany({where: {provider: 'pingcode', providerAccountId: settings.pingcode.accountId,
      status: {in: ['PENDING', 'SUBMITTING', 'QUEUED', 'SENDING', 'SENT', 'UNCERTAIN']}, attempts: {lt: 20},
      createdAt: {gte: new Date(Date.now() - 86400000)}, OR: [{lastCheckedAt: null}, {lastCheckedAt: {lte: new Date(Date.now() - 15000)}}]},
      orderBy: [{lastCheckedAt: 'asc'}, {createdAt: 'asc'}], take: limit});
    for (const row of rows) await this.sync(row);
    const events = await this.db.webhookEvent.findMany({where: {provider: 'pingcode', providerAccountId: settings.pingcode.accountId,
      status: {in: ['RECEIVED', 'UNMATCHED', 'FAILED', 'PROCESSING']},
      attempts: {lt: 20}, OR: [{nextAttemptAt: null}, {nextAttemptAt: {lte: new Date()}}]}, orderBy: {receivedAt: 'asc'}, take: limit});
    for (const event of events) if ((event.payload as unknown as SendReceipt).event === 'sms.send.status_changed') await this.processReceipt(event.id);
  }
}
