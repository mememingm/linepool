import { createHmac, timingSafeEqual } from 'node:crypto';
import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Environment } from '../environment.js';
import { ApiFailure, SchemaPipe, SignedWebhook } from '../http.js';
import { WebhookInbox } from './webhook-inbox.js';

const identifier = z.union([
  z.string().trim().min(1).max(200),
  z.number().int().positive().safe(),
]).transform(value => String(value));
const envelopeSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  event: z.literal('sms.received'),
  occurredAt: z.string().datetime({ offset: true }),
  test: z.boolean().optional(),
});
const messageSchema = envelopeSchema.extend({
  data: z.object({
    messageId: z.string().trim().min(1).max(200),
    projectId: identifier,
    numberId: identifier,
    phoneNumber: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
    from: z.string().max(500),
    content: z.string().max(16000),
  }),
});
export type RawWebhookRequest = Request & { rawBody?: Buffer };

/** LP's proposed project-aware contract; PC must confirm it before live integration. */
@Controller('webhooks/pingcode')
export class PingCodeWebhookController {
  constructor(private readonly environment: Environment, private readonly inbox: WebhookInbox) {}

  @Post()
  @HttpCode(200)
  @SignedWebhook()
  async receive(@Req() request: RawWebhookRequest) {
    const secret = this.environment.values.PINGCODE_WEBHOOK_SECRET;
    if (!secret) throw new ApiFailure(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook signing secret is not configured');
    if (!Buffer.isBuffer(request.rawBody)) {
      throw new ApiFailure(415, 'WEBHOOK_JSON_REQUIRED', 'Webhook requires an application/json body');
    }
    if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
      throw new ApiFailure(415, 'WEBHOOK_ENCODING_UNSUPPORTED', 'Compressed webhook bodies are not supported');
    }
    const timestamp = request.get('x-pingcode-timestamp') ?? '';
    const signature = request.get('x-pingcode-signature') ?? '';
    if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
      || !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
      throw new ApiFailure(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature or timestamp is invalid');
    }
    const expected = createHmac('sha256', secret).update(timestamp).update('.').update(request.rawBody).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) {
      throw new ApiFailure(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature or timestamp is invalid');
    }
    const envelope = new SchemaPipe(envelopeSchema).transform(request.body);
    if (request.get('x-pingcode-event-id') !== envelope.eventId) {
      throw new ApiFailure(400, 'WEBHOOK_EVENT_ID_MISMATCH', 'Event header does not match request body');
    }
    // Only the signed body may mark a delivery as a connection check, not an unsigned header.
    if (envelope.test === true) return { received: true };
    const event = new SchemaPipe(messageSchema).transform(request.body);
    if (Date.parse(event.occurredAt) > Date.now() + 300000) {
      throw new ApiFailure(400, 'WEBHOOK_TIME_INVALID', 'Message reception time is in the future');
    }
    await this.inbox.recordVerified({
      eventId: event.eventId, messageId: event.data.messageId,
      projectId: event.data.projectId, numberId: event.data.numberId,
      phoneNumber: event.data.phoneNumber, sender: event.data.from,
      content: event.data.content, occurredAt: event.occurredAt,
    });
    // Unknown ownership remains durably saved and private; the retry worker can route it later.
    await this.inbox.route(event.data.messageId);
    return { received: true };
  }
}
