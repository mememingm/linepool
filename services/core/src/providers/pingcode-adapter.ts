import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const time = z.iso.datetime({ offset: true });
const externalId = z.number().int().positive().safe();
const numberStatus = z.enum(['READY', 'ACTIVE', 'UNAVAILABLE', 'EXPIRED', 'DISABLED']);
const phone = z.string().regex(/^\+?[0-9]{2,32}$/);
export const pingCodeNumberSchema = z.object({
  id: externalId, phoneNumber: phone.optional(), iccid: z.string().optional(), status: numberStatus, expiresAt: time.nullish(),
});
export const pingCodeSmsSchema = z.object({
  id: z.string().regex(/^(IN-[0-9a-f-]{36}|OUT-[0-9]+)$/i), direction: z.enum(['INBOUND', 'OUTBOUND']),
  numberId: externalId, phoneNumber: phone.optional(), counterparty: z.string(), content: z.string(),
  status: z.enum(['RECEIVED', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'UNDELIVERABLE', 'FAILED', 'UNCERTAIN']),
  occurredAt: time, createdAt: time, errorCode: z.string().nullish(),
}).refine(value => value.direction === 'INBOUND'
  ? value.id.startsWith('IN-') && value.status === 'RECEIVED'
  : value.id.startsWith('OUT-') && value.status !== 'RECEIVED', 'SMS direction, ID and status must agree');
export const pingCodePageSchema = z.object({ limit: z.number().int().min(1).max(100), hasMore: z.boolean(), nextCursor: z.string().min(1).nullish() })
  .refine(page => !page.hasMore || Boolean(page.nextCursor), 'Missing nextCursor');
const receiveEventSchema = z.object({
  eventId: z.string().min(1), event: z.literal('sms.received'), occurredAt: time, test: z.boolean().optional(),
  data: z.object({ messageId: z.string().regex(/^IN-[0-9a-f-]{36}$/i), numberId: externalId, phoneNumber: phone,
    from: z.string(), content: z.string() }),
});
export type ProviderNumber = {
  externalNumberId: string; phoneNumber: string | null; iccid: string | null;
  status: z.infer<typeof numberStatus>; resourceExpiresAt: string | null;
};
export type ProviderInbound = {
  externalMessageId: string; externalNumberId: string; phoneNumber: string | null;
  sender: string; body: string; receivedAt: string; upstreamCreatedAt: string | null;
};
export type PingCodeRequest = { method: 'GET'; path: string; query: Record<string, string> };
export type PingCodeResponse = { status: number; body: unknown; headers?: Record<string, string> };
/** Deliberately injected: this work ships no fetch/HTTP transport and reads no API keys. */
export interface PingCodeTransport { request(input: PingCodeRequest): Promise<PingCodeResponse> }
export class ProviderError extends Error {
  constructor(readonly code: string, readonly status: number, readonly retryAfterSeconds: number | null = null) {
    super(code);
  }
}
export const normalizePhone = (value: string) => `+${phone.parse(value).replace(/^\+/, '')}`;
function mapNumber(value: z.infer<typeof pingCodeNumberSchema>): ProviderNumber {
  return { externalNumberId: String(value.id), phoneNumber: value.phoneNumber ? normalizePhone(value.phoneNumber) : null,
    iccid: value.iccid ?? null, status: value.status, resourceExpiresAt: value.expiresAt ?? null };
}
export function mapPingCodeInbound(value: unknown): ProviderInbound {
  const sms = pingCodeSmsSchema.parse(value);
  if (sms.direction !== 'INBOUND') throw new ProviderError('OUTBOUND_NOT_SUPPORTED', 422);
  return { externalMessageId: sms.id, externalNumberId: String(sms.numberId),
    phoneNumber: sms.phoneNumber ? normalizePhone(sms.phoneNumber) : null, sender: sms.counterparty,
    body: sms.content, receivedAt: sms.occurredAt, upstreamCreatedAt: sms.createdAt };
}

/** Document-backed read adapter. Purchase/allocation are explicitly unavailable, never fabricated. */
export class PingCodeAdapter {
  constructor(private readonly transport: PingCodeTransport) {}
  private async get(path: string, query: Record<string, string> = {}) {
    const result = await this.transport.request({ method: 'GET', path: `/pingcode/api/open/v1${path}`, query });
    if (result.status < 200 || result.status >= 300) {
      const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(result.body);
      const retry = result.headers?.['retry-after'] ?? result.headers?.['Retry-After'];
      throw new ProviderError(parsed.success ? parsed.data.error.code : 'INVALID_UPSTREAM_ERROR', result.status,
        retry && /^\d+$/.test(retry) ? Number(retry) : null);
    }
    return result.body;
  }
  async account() {
    return z.object({ id: externalId, username: z.string(), scopes: z.array(z.string()), expiresAt: time.optional() }).parse(await this.get('/me'));
  }
  async numbers(input: { limit?: number; cursor?: string; status?: z.infer<typeof numberStatus> } = {}) {
    const query = z.object({ limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).optional(), status: numberStatus.optional() }).parse(input);
    const result = z.object({ data: z.array(pingCodeNumberSchema), page: pingCodePageSchema }).parse(await this.get('/numbers', this.query(query)));
    return { data: result.data.map(mapNumber), page: result.page };
  }
  async number(phoneNumber: string) {
    return mapNumber(pingCodeNumberSchema.parse(await this.get('/numbers/by-phone', { phoneNumber: normalizePhone(phoneNumber) })));
  }
  async messages(input: { phoneNumber: string; limit?: number; cursor?: string; createdAfter?: string }) {
    const query = z.object({ phoneNumber: phone, limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().min(1).optional(), createdAfter: time.optional() }).parse(input);
    const result = z.object({ data: z.array(pingCodeSmsSchema), page: pingCodePageSchema }).parse(await this.get('/sms',
      { ...this.query(query), phoneNumber: normalizePhone(query.phoneNumber), direction: 'INBOUND' }));
    // Reject an invalid upstream direction instead of accidentally delivering outbound messages.
    return { data: result.data.map(mapPingCodeInbound), page: result.page };
  }
  async message(id: string) {
    const valid = z.string().regex(/^IN-[0-9a-f-]{36}$/i).parse(id);
    return mapPingCodeInbound(await this.get(`/sms/${encodeURIComponent(valid)}`));
  }
  purchase(): never { throw new ProviderError('PURCHASE_NOT_DOCUMENTED', 501); }
  allocate(): never { throw new ProviderError('ALLOCATION_NOT_DOCUMENTED', 501); }
  release(): never { throw new ProviderError('RELEASE_NOT_DOCUMENTED', 501); }
  private query(input: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  }
}

/** Local verification helper only; no public webhook endpoint is enabled. 300s is our local replay policy. */
export function decodePingCodeWebhook(rawBody: Buffer, headers: Record<string, string | undefined>, secret: string, now = Date.now()) {
  const timestamp = headers['x-pingcode-timestamp'] ?? '';
  const signature = headers['x-pingcode-signature'] ?? '';
  if (!secret || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^sha256=[a-f0-9]{64}$/.test(signature)) {
    throw new ProviderError('WEBHOOK_SIGNATURE_INVALID', 401);
  }
  const expected = createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) throw new ProviderError('WEBHOOK_SIGNATURE_INVALID', 401);
  const event = receiveEventSchema.parse(JSON.parse(rawBody.toString('utf8')));
  if (event.eventId !== headers['x-pingcode-event-id']) throw new ProviderError('WEBHOOK_EVENT_ID_MISMATCH', 400);
  return { eventId: event.eventId, test: event.test === true,
    message: { externalMessageId: event.data.messageId, externalNumberId: String(event.data.numberId),
      phoneNumber: normalizePhone(event.data.phoneNumber), sender: event.data.from, body: event.data.content,
      receivedAt: event.occurredAt, upstreamCreatedAt: null } satisfies ProviderInbound };
}
