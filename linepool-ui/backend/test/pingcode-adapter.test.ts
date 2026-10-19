import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { PingCodeAdapter, ProviderError, decodePingCodeWebhook, mapPingCodeInbound,
  type PingCodeResponse, type PingCodeTransport } from '../src/providers/pingcode-adapter.js';
import { MockPingCodeTransport } from '../src/providers/mock-pingcode-transport.js';
import { allocationStatus } from '../src/providers/receiving-provider.js';

const date = '2026-10-17T00:00:00Z';
const sms = { id: 'IN-550e8400-e29b-41d4-a716-446655440000', direction: 'INBOUND', numberId: 108,
  phoneNumber: '19863011654', counterparty: '+8613800138000', content: 'Your code is 123456',
  status: 'RECEIVED', occurredAt: '2026-09-17T08:30:00Z', createdAt: '2026-09-17T08:30:01Z' };
const errorCode = (code: string) => (error: unknown) => error instanceof ProviderError && error.code === code;
const responseTransport = (response: PingCodeResponse): PingCodeTransport => ({ request: async () => response });

test('documented account, number normalization, omitted fields and opaque cursor pagination', async () => {
  const transport = new MockPingCodeTransport({ numbers: [
    { id: 108, phoneNumber: '19863011654', iccid: '8986000000000000001', status: 'ACTIVE', expiresAt: date },
    { id: 109, status: 'READY' },
  ], messages: [] });
  const adapter = new PingCodeAdapter(transport);
  assert.deepEqual((await adapter.account()).scopes, ['numbers:read', 'sms:read']);
  const first = await adapter.numbers({ limit: 1 });
  assert.equal(first.data[0]!.phoneNumber, null);
  assert.equal(first.data[0]!.resourceExpiresAt, null);
  assert.equal(first.page.hasMore, true);
  const second = await adapter.numbers({ limit: 1, cursor: first.page.nextCursor });
  assert.equal(second.data[0]!.externalNumberId, '108');
  assert.equal(second.data[0]!.phoneNumber, '+19863011654');
  assert.equal(second.data[0]!.resourceExpiresAt, date);
  assert.equal(second.page.nextCursor, undefined);
  assert.equal((await adapter.number('+19863011654')).iccid, '8986000000000000001');
  assert.equal(transport.requests.at(-1)!.path, '/pingcode/api/open/v1/numbers/by-phone');
  assert.equal(transport.requests[2]!.query.cursor, first.page.nextCursor);
  assert.equal(transport.requests.every(request => request.method === 'GET'), true);
});

test('inbound mapping preserves provider ID, occurrence time, incremental time and full text', async () => {
  const transport = new MockPingCodeTransport({ numbers: [], messages: [sms, { ...sms, id: 'OUT-231', direction: 'OUTBOUND', status: 'QUEUED' }] });
  const adapter = new PingCodeAdapter(transport);
  const page = await adapter.messages({ phoneNumber: sms.phoneNumber, createdAfter: '2026-09-17T08:30:00Z' });
  assert.equal(page.data.length, 1);
  assert.deepEqual(page.data[0], { externalMessageId: sms.id, externalNumberId: '108', phoneNumber: '+19863011654',
    sender: sms.counterparty, body: sms.content, receivedAt: sms.occurredAt, upstreamCreatedAt: sms.createdAt });
  assert.equal(transport.requests[0]!.query.direction, 'INBOUND');
  assert.equal(transport.requests[0]!.query.createdAfter, '2026-09-17T08:30:00Z');
  assert.equal((await adapter.message(sms.id)).body, sms.content);
  await assert.rejects(adapter.message('OUT-231'));
  assert.throws(() => mapPingCodeInbound({ ...sms, id: 'OUT-231', direction: 'OUTBOUND', status: 'QUEUED' }), errorCode('OUTBOUND_NOT_SUPPORTED'));
});

test('all upstream resource statuses are preserved, not confused with local service expiry', async () => {
  for (const status of ['READY', 'ACTIVE', 'UNAVAILABLE', 'EXPIRED', 'DISABLED']) {
    const adapter = new PingCodeAdapter(responseTransport({ status: 200, body: { id: 108, status, expiresAt: date } }));
    assert.equal((await adapter.number(sms.phoneNumber)).status, status);
  }
  assert.equal(allocationStatus(new Date(date), Date.parse(date) - 1), 'ACTIVE');
  assert.equal(allocationStatus(new Date(date), Date.parse(date)), 'EXPIRED');
});

test('invalid response fields, missing cursor, unknown statuses and wrong directions fail closed', async () => {
  const badResponses = [
    { data: [{ id: 1, status: 'DEVICE_OFFLINE' }], page: { limit: 50, hasMore: false } },
    { data: [], page: { limit: 50, hasMore: true } },
    { data: [{ id: '108', status: 'ACTIVE' }], page: { limit: 50, hasMore: false } },
  ];
  for (const body of badResponses) await assert.rejects(new PingCodeAdapter(responseTransport({ status: 200, body })).numbers());
  await assert.rejects(new PingCodeAdapter(responseTransport({ status: 200, body: {
    data: [{ ...sms, direction: 'OUTBOUND' }], page: { limit: 50, hasMore: false },
  } })).messages({ phoneNumber: sms.phoneNumber }));
  await assert.rejects(new PingCodeAdapter(responseTransport({ status: 200, body: {} })).numbers({ limit: 101 }));
});

test('both error envelopes use error.code; 429 preserves Retry-After and never retries', async () => {
  for (const response of [
    { status: 401, body: { error: { code: 'OPEN_API_KEY_INVALID', message: 'arbitrary text' } } },
    { status: 403, body: { status: 403, timestamp: date, message: 'arbitrary', error: { code: 'OPEN_API_SCOPE_DENIED', message: 'arbitrary', requestId: 'req-fixture' } } },
  ]) {
    await assert.rejects(new PingCodeAdapter(responseTransport(response)).account(), errorCode(response.body.error.code));
  }
  let requests = 0;
  const adapter = new PingCodeAdapter({ request: async () => { requests++; return {
    status: 429, body: { error: { code: 'RATE_LIMITED', message: 'slow down' } }, headers: { 'Retry-After': '12' },
  }; } });
  await assert.rejects(adapter.account(), (error: unknown) => error instanceof ProviderError && error.code === 'RATE_LIMITED' && error.retryAfterSeconds === 12);
  assert.equal(requests, 1);
  await assert.rejects(new PingCodeAdapter({ request: async () => { throw new Error('mock timeout'); } }).numbers(), /mock timeout/);
});

test('undocumented purchase, allocation and release never issue a request', () => {
  const transport = new MockPingCodeTransport();
  const adapter = new PingCodeAdapter(transport);
  assert.throws(() => adapter.purchase(), errorCode('PURCHASE_NOT_DOCUMENTED'));
  assert.throws(() => adapter.allocate(), errorCode('ALLOCATION_NOT_DOCUMENTED'));
  assert.throws(() => adapter.release(), errorCode('RELEASE_NOT_DOCUMENTED'));
  assert.equal(transport.requests.length, 0);
});

test('receive webhook verifies raw bytes, timestamp, signature, event ID and test markers', () => {
  const secret = 'mock-webhook-secret';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = { eventId: 'evt-mock', event: 'sms.received', occurredAt: sms.occurredAt,
    data: { messageId: sms.id, numberId: 108, phoneNumber: sms.phoneNumber, from: sms.counterparty, content: sms.content } };
  const raw = Buffer.from(JSON.stringify(payload));
  const headers = { 'x-pingcode-event-id': payload.eventId, 'x-pingcode-timestamp': timestamp,
    'x-pingcode-signature': `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}` };
  const decoded = decodePingCodeWebhook(raw, headers, secret);
  assert.equal(decoded.message.externalMessageId, sms.id);
  assert.equal(decoded.message.upstreamCreatedAt, null);
  assert.equal(decoded.test, false);
  assert.equal(decodePingCodeWebhook(raw, { ...headers, 'x-pingcode-test': 'true' }, secret).test, true);
  assert.throws(() => decodePingCodeWebhook(Buffer.concat([raw, Buffer.from(' ')]), headers, secret), errorCode('WEBHOOK_SIGNATURE_INVALID'));
  assert.throws(() => decodePingCodeWebhook(raw, headers, 'wrong-secret'), errorCode('WEBHOOK_SIGNATURE_INVALID'));
  assert.throws(() => decodePingCodeWebhook(raw, headers, secret, (Number(timestamp) + 301) * 1000), errorCode('WEBHOOK_SIGNATURE_INVALID'));
  assert.throws(() => decodePingCodeWebhook(raw, { ...headers, 'x-pingcode-event-id': 'other-event' }, secret), errorCode('WEBHOOK_EVENT_ID_MISMATCH'));
});
