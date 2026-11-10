import { BadRequestException, ConflictException, Controller, HttpCode, Post, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { DbService } from './db.service';
import { fingerprint } from './business';
import { settings } from './config';
import { pcStatuses } from './pingcode.client';
import { OutboundService, SendReceipt } from './outbound.service';

@Controller('api/webhooks/pingcode')
export class SendWebhookController {
  constructor(private readonly db: DbService, private readonly outbound: OutboundService) {}
  @Post('send') @HttpCode(204)
  async receive(@Req() req: Request & {rawBody?: Buffer}) {
    const {accountId, sendWebhookSecret} = settings.pingcode;
    if (!accountId || !sendWebhookSecret) throw new ServiceUnavailableException('Send webhook is not configured');
    const timestamp = req.get('x-pingcode-timestamp') || '';
    const signature = req.get('x-pingcode-signature') || '';
    if (!/^\d{10,11}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
        !/^sha256=[a-f0-9]{64}$/i.test(signature) || !req.rawBody) throw new UnauthorizedException('Invalid webhook signature or timestamp');
    const expected = createHmac('sha256', sendWebhookSecret).update(timestamp + '.').update(req.rawBody).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) throw new UnauthorizedException('Invalid webhook signature or timestamp');
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid send event');
    if (body.test === true) return;
    const payload = body as unknown as SendReceipt;
    const data = payload.data;
    if (typeof payload.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.eventId) ||
        req.get('x-pingcode-event-id') !== payload.eventId || payload.event !== 'sms.send.status_changed' ||
        typeof payload.occurredAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(payload.occurredAt) || !Number.isFinite(Date.parse(payload.occurredAt)) ||
        Date.parse(payload.occurredAt) > Date.now() + 300000 || !data || typeof data !== 'object' ||
        typeof data.messageId !== 'string' || !/^OUT-\d+$/.test(data.messageId) || !Number.isSafeInteger(data.senderNumberId) || data.senderNumberId <= 0 ||
        typeof data.senderPhoneNumber !== 'string' || data.senderPhoneNumber.length > 40 ||
        typeof data.recipient !== 'string' || data.recipient.length > 40 || !pcStatuses.includes(data.status) ||
        (data.errorCode !== undefined && data.errorCode !== null && (typeof data.errorCode !== 'string' || data.errorCode.length > 200)))
      throw new BadRequestException('Invalid send event');
    const hash = fingerprint(body);
    const saved = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${accountId + ':send:' + payload.eventId},0))`;
      const where = {provider_providerAccountId_eventId: {provider: 'pingcode', providerAccountId: accountId, eventId: payload.eventId}};
      const previous = await tx.webhookEvent.findUnique({where});
      if (previous) {
        if (previous.payloadHash !== hash) {
          await tx.webhookEvent.update({where: {id: previous.id}, data: {conflictCount: {increment: 1}, lastConflictHash: hash, lastConflictAt: new Date()}});
          return {row: previous, conflict: true};
        }
        return {row: previous, conflict: false};
      }
      const row = await tx.webhookEvent.create({data: {provider: 'pingcode', providerAccountId: accountId,
        providerNumberId: String(data.senderNumberId), providerMessageId: data.messageId, occurredAt: new Date(payload.occurredAt),
        eventId: payload.eventId, payload: body as Prisma.InputJsonValue, payloadHash: hash}});
      return {row, conflict: false};
    });
    if (saved.conflict) throw new ConflictException('Webhook event ID has conflicting content');
    await this.outbound.processReceipt(saved.row.id);
  }
}
