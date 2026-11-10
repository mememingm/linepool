import { BadRequestException, ConflictException, Controller, HttpCode, Injectable, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { DbService } from './db.service';
import { fingerprint, lockPhone, lockUser, transactionOptions } from './business';
import { normalizePhone } from './pingcode.client';
import { settings } from './config';
import { verifyWebhook } from './webhook-auth';
import { traceWebhook } from './webhook-trace';

// Confirmed against PingCode docs/api/开放API-接入说明.md, “新短信通知”.
type Incoming = {eventId: string; event: 'sms.received'; occurredAt: string;
  data: {messageId: string; numberId: number; phoneNumber: string; from: string; content: string}};

@Injectable()
export class IncomingService {
  constructor(private readonly db: DbService) {}
  async receive(body: Incoming) {
    const accountId = settings.pingcode.accountId, hash = fingerprint(body);
    const saved = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${accountId + ':receive:' + body.eventId},0))`;
      const where = {provider_providerAccountId_eventId: {provider: 'pingcode', providerAccountId: accountId, eventId: body.eventId}};
      const previous = await tx.webhookEvent.findUnique({where});
      if (previous) {
        if (previous.payloadHash !== hash) {
          await tx.webhookEvent.update({where: {id: previous.id}, data: {conflictCount: {increment: 1}, lastConflictHash: hash, lastConflictAt: new Date()}});
          return {id: previous.id, conflict: true};
        }
        return {id: previous.id, conflict: false};
      }
      const row = await tx.webhookEvent.create({data: {provider: 'pingcode', providerAccountId: accountId,
        providerNumberId: String(body.data.numberId), providerMessageId: body.data.messageId, occurredAt: new Date(body.occurredAt),
        eventId: body.eventId, payload: body as unknown as Prisma.InputJsonValue, payloadHash: hash}});
      return {id: row.id, conflict: false};
    });
    if (saved.conflict) throw new ConflictException('Webhook event ID has conflicting content');
    await this.process(saved.id, 'RECEIVE');
  }
  async process(id: string, source = 'AUTO') {
    await traceWebhook(this.db, id, source, () => this.processLogged(id));
  }
  private async processLogged(id: string) {
    try { await this.attribute(id); }
    catch (error) {
      await this.db.webhookEvent.updateMany({where: {id, status: {notIn: ['PROCESSED', 'QUARANTINED']}},
        data: {status: 'FAILED', attempts: {increment: 1}, lastError: 'INBOUND_PROCESSING_FAILED', nextAttemptAt: new Date(Date.now() + 30000)}});
      throw error;
    }
  }
  private async attribute(id: string) {
    const event = await this.db.webhookEvent.findUniqueOrThrow({where: {id}});
    if (event.provider !== 'pingcode' || event.providerAccountId !== settings.pingcode.accountId) return;
    if (['PROCESSED', 'QUARANTINED'].includes(event.status)) return;
    const payload = event.payload as unknown as Incoming;
    if (event.payloadHash !== fingerprint(payload) || payload.event !== 'sms.received') {
      await this.db.webhookEvent.updateMany({where: {id, status: {notIn: ['PROCESSED', 'QUARANTINED']}},
        data: {status: 'QUARANTINED', lastError: 'INVALID_RECEIVE_EVENT', nextAttemptAt: null}});
      return;
    }
    const phone = await this.db.phoneNumber.findUnique({where: {provider_providerAccountId_providerNumberId: {
      provider: event.provider, providerAccountId: event.providerAccountId, providerNumberId: event.providerNumberId!}}});
    const at = new Date(payload.occurredAt);
    const lease = phone ? await this.db.lease.findFirst({where: {phoneNumberId: phone.id, startedAt: {lte: at}, expiresAt: {gt: at},
      OR: [{endedAt: null}, {endedAt: {gt: at}}]}}) : null;
    if (!phone || !lease) {
      await this.db.webhookEvent.updateMany({where: {id, status: {notIn: ['PROCESSED', 'QUARANTINED']}}, data: {
        status: 'UNMATCHED', attempts: {increment: 1}, lastError: 'INBOUND_LEASE_NOT_MATCHED', nextAttemptAt: new Date(Date.now() + 30000)}});
      return;
    }
    await this.db.$transaction(async tx => {
      await lockUser(tx, lease.userId); await lockPhone(tx, phone.id);
      // Serialize different event IDs for the same upstream message as well as duplicate deliveries.
      const current = await tx.webhookEvent.findUniqueOrThrow({where: {id}});
      if (['PROCESSED', 'QUARANTINED'].includes(current.status)) return;
      const service = await tx.lease.findUniqueOrThrow({where: {id: lease.id}});
      const currentPhone = await tx.phoneNumber.findUniqueOrThrow({where: {id: phone.id}});
      if (currentPhone.provider !== event.provider || currentPhone.providerAccountId !== event.providerAccountId ||
          currentPhone.providerNumberId !== event.providerNumberId || service.phoneNumberId !== currentPhone.id ||
          normalizePhone(currentPhone.number) !== normalizePhone(payload.data.phoneNumber) || at < service.startedAt || at >= (service.endedAt || service.expiresAt)) {
        await tx.webhookEvent.update({where: {id}, data: {status: 'QUARANTINED', lastError: 'INBOUND_IDENTITY_OR_WINDOW_CONFLICT', nextAttemptAt: null}});
        return;
      }
      const identity = {provider: event.provider, providerAccountId: event.providerAccountId, providerMessageId: payload.data.messageId};
      const previous = await tx.message.findUnique({where: {provider_providerAccountId_providerMessageId: identity}});
      if (previous && (previous.leaseId !== lease.id || normalizePhone(previous.sender) !== normalizePhone(payload.data.from) ||
          previous.body !== payload.data.content || +previous.receivedAt !== +at)) {
        await tx.webhookEvent.update({where: {id}, data: {status: 'QUARANTINED', lastError: 'INBOUND_MESSAGE_CONFLICT', nextAttemptAt: null}});
        return;
      }
      if (!previous) await tx.message.create({data: {...identity, leaseId: lease.id, sender: payload.data.from, title: '', body: payload.data.content, receivedAt: at}});
      await tx.webhookEvent.update({where: {id}, data: {leaseId: lease.id, status: 'PROCESSED', processedAt: new Date(),
        attempts: {increment: 1}, nextAttemptAt: null, lastError: null}});
    }, transactionOptions);
  }
  async recover(limit = 25) {
    if (!settings.pingcode.accountId) return;
    const rows = await this.db.webhookEvent.findMany({where: {provider: 'pingcode', providerAccountId: settings.pingcode.accountId,
      status: {in: ['RECEIVED', 'UNMATCHED', 'FAILED', 'PROCESSING']}, attempts: {lt: 20},
      OR: [{nextAttemptAt: null}, {nextAttemptAt: {lte: new Date()}}]}, orderBy: {receivedAt: 'asc'}, take: limit});
    for (const row of rows) if ((row.payload as unknown as Incoming).event === 'sms.received') {
      try { await this.process(row.id); } catch { /* Failure is persisted; continue other users' messages. */ }
    }
  }
}

@Controller('api/webhooks/pingcode')
export class ReceiveWebhookController {
  constructor(private readonly incoming: IncomingService) {}
  @Post('receive') @HttpCode(204)
  async receive(@Req() req: Request & {rawBody?: Buffer}) {
    if (!settings.pingcode.accountId) throw new ServiceUnavailableException('Receive webhook is not configured');
    verifyWebhook(req, settings.pingcode.receiveWebhookSecret);
    const payload = req.body as Incoming;
    if ((payload as unknown as {test?: boolean})?.test === true) return;
    const data = payload?.data;
    if (!payload || typeof payload.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.eventId) ||
        req.get('x-pingcode-event-id') !== payload.eventId || payload.event !== 'sms.received' ||
        typeof payload.occurredAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(payload.occurredAt) || !Number.isFinite(Date.parse(payload.occurredAt)) ||
        Date.parse(payload.occurredAt) > Date.now() + 300000 || !data || !Number.isSafeInteger(data.numberId) || data.numberId <= 0 ||
        typeof data.messageId !== 'string' || !/^IN-[A-Za-z0-9_-]{1,128}$/.test(data.messageId) ||
        typeof data.phoneNumber !== 'string' || !/^\+?[1-9]\d{1,14}$/.test(data.phoneNumber) ||
        typeof data.from !== 'string' || !data.from.trim() || data.from.length > 120 ||
        typeof data.content !== 'string' || data.content.length > 12000) throw new BadRequestException('Invalid received SMS event');
    await this.incoming.receive(payload);
  }
}
