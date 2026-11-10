import { createHmac, timingSafeEqual } from 'node:crypto';
import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Environment } from '../environment.js';
import { ApiFailure, SchemaPipe, SignedWebhook } from '../http.js';
import { WebhookInbox } from './webhook-inbox.js';
import { requireMessageSandbox } from '../once/message-access.js';

const identifier = z.union([z.string().trim().min(1).max(200),z.number().int().positive().safe()]).transform(value => String(value));
const envelopeSchema = z.object({ eventId: z.string().trim().min(1).max(200),
  event: z.enum(['sms.received','sms.send.status_changed']), occurredAt: z.iso.datetime({ offset: true }), test: z.boolean().optional() });
const receiveData = z.object({ messageId: z.string().trim().min(1).max(200), numberId: identifier,
  phoneNumber: z.string().regex(/^\+[1-9][0-9]{1,14}$/), from: z.string().max(500), content: z.string().max(16000),
  title: z.string().max(200).optional(), code: z.string().max(64).optional() });
const lpMessageSchema = envelopeSchema.extend({ event: z.literal('sms.received'), data: receiveData.extend({ projectId: identifier }) });
const wholeMessageSchema = envelopeSchema.extend({ event: z.literal('sms.received'), data: receiveData });
const sendSchema = envelopeSchema.extend({ event: z.literal('sms.send.status_changed'), data: z.object({ messageId: identifier,
  senderNumberId: identifier, senderPhoneNumber: z.string().regex(/^\+[1-9][0-9]{1,14}$/),
  recipient: z.string().regex(/^\+[1-9][0-9]{1,14}$/), status: z.enum(['QUEUED','SENDING','SENT','UNCERTAIN','DELIVERED','UNDELIVERABLE','FAILED']),
  errorCode: z.string().max(200).nullable().optional() }) });
export type RawWebhookRequest = Request & { rawBody?: Buffer };

/** Shared raw-body verification for local Mock callbacks. Worker pull/lookup never needs this endpoint. */
function verifyMockWebhook(request: RawWebhookRequest, environment: Environment) {
  if (environment.pcProvider !== 'pingcode-mock') throw new ApiFailure(404, 'WEBHOOK_NOT_FOUND', 'Real PinClode ingress uses worker pulls');
  requireMessageSandbox(environment);
  const secret = environment.values.PINGCODE_WEBHOOK_SECRET;
  if (!secret) throw new ApiFailure(503, 'WEBHOOK_NOT_CONFIGURED', 'Mock signing secret is not configured');
  if (!Buffer.isBuffer(request.rawBody)) throw new ApiFailure(415, 'WEBHOOK_JSON_REQUIRED', 'Webhook requires an application/json body');
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
    throw new ApiFailure(415, 'WEBHOOK_ENCODING_UNSUPPORTED', 'Compressed webhook bodies are not supported');
  }
  const timestamp = request.get('x-pingcode-timestamp') ?? '', signature = request.get('x-pingcode-signature') ?? '';
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
    throw new ApiFailure(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature or timestamp is invalid');
  }
  const expected = createHmac('sha256', secret).update(timestamp).update('.').update(request.rawBody).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) throw new ApiFailure(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature or timestamp is invalid');
  const envelope = new SchemaPipe(envelopeSchema).transform(request.body);
  if (request.get('x-pingcode-event-id') !== envelope.eventId) throw new ApiFailure(400, 'WEBHOOK_EVENT_ID_MISMATCH', 'Event header does not match request body');
  if (Date.parse(envelope.occurredAt) > Date.now()) throw new ApiFailure(400, 'WEBHOOK_TIME_INVALID', 'Message occurrence time cannot be in the future');
  return envelope;
}

@Controller('webhooks/pingcode')
export class PingCodeWebhookController {
  constructor(private readonly environment: Environment, private readonly inbox: WebhookInbox) {}
  @Post()
  @HttpCode(200)
  @SignedWebhook()
  async receive(@Req() request: RawWebhookRequest) {
    if (this.environment.siteId !== 'linepool') throw new ApiFailure(404, 'WEBHOOK_NOT_FOUND', 'Webhook not found');
    const envelope = verifyMockWebhook(request, this.environment);
    if (envelope.test) return { received: true };
    const event = new SchemaPipe(lpMessageSchema).transform(request.body);
    const saved = await this.inbox.recordVerified({ scopeKind: 'PROJECT', externalProjectId: event.data.projectId }, {
      eventId: event.eventId, messageId: event.data.messageId, numberId: event.data.numberId,
      phoneNumber: event.data.phoneNumber, sender: event.data.from, title: event.data.title, code: event.data.code,
      content: event.data.content, occurredAt: event.occurredAt, rawPayload: event });
    await this.inbox.routeEvent(saved.eventId);
    return { received: true };
  }
}

@Controller('once/webhooks/pingcode')
export class OnceMockWebhookController {
  constructor(private readonly environment: Environment, private readonly inbox: WebhookInbox) {}
  @Post('receive')
  @HttpCode(204)
  @SignedWebhook()
  async receive(@Req() request: RawWebhookRequest) {
    if (this.environment.siteId !== 'once') throw new ApiFailure(404, 'WEBHOOK_NOT_FOUND', 'Webhook not found');
    const envelope = verifyMockWebhook(request, this.environment);
    if (envelope.test) return;
    const event = new SchemaPipe(wholeMessageSchema).transform(request.body);
    const saved = await this.inbox.recordVerified({ scopeKind: 'ACCOUNT' }, { eventId: event.eventId,
      messageId: event.data.messageId, numberId: event.data.numberId, phoneNumber: event.data.phoneNumber,
      sender: event.data.from, title: event.data.title, code: event.data.code, content: event.data.content,
      occurredAt: event.occurredAt, rawPayload: event });
    await this.inbox.routeEvent(saved.eventId);
  }
  @Post('send')
  @HttpCode(204)
  @SignedWebhook()
  async send(@Req() request: RawWebhookRequest) {
    if (this.environment.siteId !== 'once') throw new ApiFailure(404, 'WEBHOOK_NOT_FOUND', 'Webhook not found');
    const envelope = verifyMockWebhook(request, this.environment);
    if (envelope.test) return;
    const event = new SchemaPipe(sendSchema).transform(request.body);
    const saved = await this.inbox.recordOutbound({ provider: 'pingcode-mock', eventId: event.eventId, providerMessageId: event.data.messageId,
      numberId: event.data.senderNumberId, phoneNumber: event.data.senderPhoneNumber, recipient: event.data.recipient,
      status: event.data.status, errorCode: event.data.errorCode, occurredAt: event.occurredAt, rawPayload: event });
    await this.inbox.routeEvent(saved.eventId);
  }
}
