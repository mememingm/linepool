import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Response } from 'express';
import { createOrderInputSchema, registerInputSchema } from '@linepool/contracts';
import { ApiFailure } from '../src/http.js';
import { Ordering } from '../src/ordering.js';
import { MockReceivingProvider } from '../src/providers/mock-receiving-provider.js';
import { MockPingCodeTransport } from '../src/providers/mock-pingcode-transport.js';
import { PingCodeAdapter, mapPingCodeInbound } from '../src/providers/pingcode-adapter.js';
import { ReceivingSync, type MockInboundRoute } from '../src/providers/receiving-sync.js';
import { isolatedDatabase } from './isolated-database.js';

type Fixture = Awaited<ReturnType<typeof isolatedDatabase>>;
const intent = (change = {}) => createOrderInputSchema.parse({ region: 'us', service: 'Telegram', plan: 'week', quantity: 1, idempotencyKey: randomUUID(), ...change });
const hasCode = (code: string) => (error: unknown) => error instanceof ApiFailure && (error.getResponse() as { error: { code: string } }).error.code === code;
async function member(fixture: Fixture) {
  const user = await fixture.auth.register(registerInputSchema.parse({ email: `provider-${randomUUID()}@example.invalid`,
    password: 'mock-provider-fixture', displayName: 'Mock buyer' }), { cookie() { return this; }, clearCookie() { return this; } } as unknown as Response);
  await fixture.db.transaction(async client => {
    await client.query('UPDATE users SET points_balance=100 WHERE id=$1', [user.id]);
    await client.query("INSERT INTO point_ledger(user_id,type,delta,balance_after,description) VALUES($1,'SEED_CREDIT',100,100,'Mock fixture')", [user.id]);
  });
  return user;
}
async function snapshot(fixture: Fixture, userId: string) {
  return (await fixture.client.query(`SELECT
    (SELECT points_balance FROM users WHERE id=$1) AS balance,
    (SELECT count(*)::int FROM orders WHERE user_id=$1) AS orders,
    (SELECT count(*)::int FROM phone_numbers WHERE assigned_user_id=$1) AS numbers,
    (SELECT count(*)::int FROM number_allocations WHERE user_id=$1) AS allocations,
    (SELECT count(*)::int FROM point_ledger WHERE user_id=$1 AND type='ORDER_DEBIT') AS debits`, [userId])).rows[0];
}
async function routeFor(fixture: Fixture, numberId: string): Promise<MockInboundRoute> {
  const { rows: [row] } = await fixture.client.query<{ id: string }>('SELECT id FROM number_allocations WHERE number_id=$1 AND released_at IS NULL', [numberId]);
  return { numberId, allocationId: row!.id, service: 'Telegram' };
}
function inbound(phoneNumber: string, change = {}) {
  const occurredAt = new Date().toISOString();
  return { id: `IN-${randomUUID()}`, numberId: 108, phoneNumber, direction: 'INBOUND', counterparty: 'mock-sender',
    content: 'Mock Telegram verification: 123456', status: 'RECEIVED', occurredAt, createdAt: occurredAt, ...change };
}

test('Mock purchase, repeated retries, points and allocations remain atomic and scoped', async t => {
  const fixture = await isolatedDatabase(); t.after(() => fixture.close());
  const user = await member(fixture);
  const provider = new MockReceivingProvider();
  const ordering = new Ordering(fixture.db, fixture.workspace, provider);
  const input = intent({ areaCode: '959', quantity: 2 });
  const results = await Promise.all(Array.from({ length: 4 }, () => ordering.create(user.id, input)));
  assert.equal(new Set(results.map(order => order.id)).size, 1);
  assert.equal(results[0]!.numbers.length, 2);
  assert.equal(results[0]!.numbers.every(number => number.phoneNumber.startsWith('+1959')), true);
  assert.equal(results[0]!.isDemo, true);
  assert.equal((await snapshot(fixture, user.id)).debits, 1);
  assert.equal((await snapshot(fixture, user.id)).allocations, 2);
  const snapshotRow = await fixture.client.query('SELECT product_snapshot FROM orders WHERE id=$1', [results[0]!.id]);
  assert.equal(snapshotRow.rows[0].product_snapshot.source, 'mock');
  const before = await snapshot(fixture, user.id);
  await assert.rejects(ordering.create(user.id, { ...input, areaCode: '212' }), hasCode('IDEMPOTENCY_CONFLICT'));
  assert.deepEqual(await snapshot(fixture, user.id), before);
  const other = await member(fixture);
  const another = await ordering.create(other.id, input);
  assert.notEqual(another.id, results[0]!.id);
  assert.equal(another.numbers.some(number => results[0]!.numbers.some(first => first.id === number.id)), false);
});

test('Mock no stock, insufficient points and a late failure roll back all business writes', async t => {
  const fixture = await isolatedDatabase(); t.after(() => fixture.close());
  const user = await member(fixture);
  const before = await snapshot(fixture, user.id);
  await assert.rejects(fixture.ordering.create(user.id, intent({ areaCode: '212' })), hasCode('INSUFFICIENT_STOCK'));
  assert.deepEqual(await snapshot(fixture, user.id), before);
  await fixture.client.query('UPDATE users SET points_balance=0 WHERE id=$1', [user.id]);
  await assert.rejects(fixture.ordering.create(user.id, intent()), hasCode('INSUFFICIENT_POINTS'));
  await fixture.client.query('UPDATE users SET points_balance=100 WHERE id=$1', [user.id]);
  await fixture.client.query(`CREATE FUNCTION reject_provider_debit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.type='ORDER_DEBIT' THEN RAISE EXCEPTION 'Mock debit failure'; END IF; RETURN NEW; END $$`);
  await fixture.client.query('CREATE TRIGGER reject_provider_debit BEFORE INSERT ON point_ledger FOR EACH ROW EXECUTE FUNCTION reject_provider_debit()');
  await assert.rejects(fixture.ordering.create(user.id, intent()), /Mock debit failure/);
  assert.deepEqual(await snapshot(fixture, user.id), before);
});

test('Mock concurrent buyers cannot allocate the final resource twice', async t => {
  const fixture = await isolatedDatabase(); t.after(() => fixture.close());
  const users = await Promise.all([member(fixture), member(fixture)]);
  await fixture.client.query(`UPDATE phone_numbers SET sale_enabled=false WHERE region_id='us' AND service='Telegram' AND assigned_user_id IS NULL
    AND id<>(SELECT id FROM phone_numbers WHERE region_id='us' AND service='Telegram' AND assigned_user_id IS NULL ORDER BY id LIMIT 1)`);
  const result = await Promise.allSettled(users.map(user => fixture.ordering.create(user.id, intent())));
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  const balances = await Promise.all(users.map(user => snapshot(fixture, user.id)));
  assert.equal(balances.reduce((sum, row) => sum + row.debits, 0), 1);
  assert.equal(balances.reduce((sum, row) => sum + row.numbers, 0), 1);
});

test('Mock purchase -> explicit mapping -> polling/webhook dedup -> user-isolated inbox', async t => {
  const fixture = await isolatedDatabase(); t.after(() => fixture.close());
  const user = await member(fixture); const other = await member(fixture);
  const order = await fixture.ordering.create(user.id, intent());
  const number = order.numbers[0]!;
  const route = await routeFor(fixture, number.id);
  const wire = inbound(number.phoneNumber);
  const transport = new MockPingCodeTransport({ numbers: [{ id: 108, phoneNumber: number.phoneNumber, status: 'ACTIVE' }], messages: [wire] });
  const provider = new MockReceivingProvider(new PingCodeAdapter(transport));
  const sync = new ReceivingSync(fixture.db, provider);
  await sync.bindMockNumber(number.id, await provider.reader.number(number.phoneNumber));
  assert.deepEqual(await sync.pullMock(route), { imported: 1, duplicates: 0 });
  assert.deepEqual(await sync.pullMock(route), { imported: 0, duplicates: 1 });
  const message = mapPingCodeInbound(wire);
  // Polling and webhook may serialize the same instant with different fractional precision.
  assert.equal((await sync.receiveMock(route, { ...message,
    receivedAt: message.receivedAt.replace('Z', '000Z'), upstreamCreatedAt: null,
  })).status, 'DUPLICATE');
  const results = await Promise.all(Array.from({ length: 4 }, () => sync.receiveMock(route, message, { eventId: 'evt-mock', test: false })));
  assert.equal(results.every(result => result.status === 'DUPLICATE'), true);
  const inbox = await fixture.workspace.inbox(user.id, { page: 1, pageSize: 20, search: '' });
  assert.equal(inbox.pagination.totalItems, 1);
  assert.equal(inbox.data[0]!.body, wire.content);
  assert.equal(inbox.data[0]!.verificationCode, null);
  assert.equal((await fixture.workspace.inbox(other.id, { page: 1, pageSize: 20, search: '' })).pagination.totalItems, 0);
  await assert.rejects(sync.receiveMock({ ...route, service: 'WhatsApp' }, mapPingCodeInbound(inbound(number.phoneNumber))), hasCode('PROVIDER_ROUTE_UNCONFIRMED'));
  await assert.rejects(sync.receiveMock(route, { ...message, body: 'changed' }), hasCode('PROVIDER_MESSAGE_CONFLICT'));
  await assert.rejects(sync.receiveMock(route, mapPingCodeInbound(inbound(number.phoneNumber)), { eventId: 'evt-mock', test: false }), hasCode('PROVIDER_EVENT_CONFLICT'));
  assert.equal((await sync.receiveMock(route, mapPingCodeInbound(inbound(number.phoneNumber)), { eventId: 'evt-test', test: true })).status, 'TEST_IGNORED');
  assert.equal((await fixture.client.query('SELECT count(*)::int AS total FROM provider_event_receipts')).rows[0].total, 1);
});

test('unmapped or wrong-phone resources and stale allocations never receive messages', async t => {
  const fixture = await isolatedDatabase(); t.after(() => fixture.close());
  const user = await member(fixture);
  const order = await fixture.ordering.create(user.id, intent());
  const number = order.numbers[0]!;
  const route = await routeFor(fixture, number.id);
  const sync = new ReceivingSync(fixture.db, new MockReceivingProvider());
  await assert.rejects(sync.pullMock(route), hasCode('PROVIDER_ROUTE_UNCONFIRMED'));
  await assert.rejects(sync.bindMockNumber(number.id, { externalNumberId: '108', phoneNumber: '+12025550123', iccid: null, status: 'ACTIVE', resourceExpiresAt: null }), hasCode('PROVIDER_NUMBER_MISMATCH'));
  await sync.bindMockNumber(number.id, { externalNumberId: '108', phoneNumber: number.phoneNumber, iccid: null, status: 'ACTIVE', resourceExpiresAt: null });
  const message = mapPingCodeInbound(inbound(number.phoneNumber));
  await assert.rejects(sync.receiveMock({ ...route, allocationId: randomUUID() }, message), hasCode('PROVIDER_ROUTE_UNCONFIRMED'));
  await assert.rejects(sync.receiveMock(route, { ...message, phoneNumber: '+12025550123' }), hasCode('PROVIDER_ROUTE_UNCONFIRMED'));
  await assert.rejects(sync.receiveMock(route, { ...message, receivedAt: '2000-01-01T00:00:00Z' }), hasCode('PROVIDER_ALLOCATION_INACTIVE'));
});

test('7/30 day expiry retains history, stops new reception and does not refund or recycle', async t => {
  const fixture = await isolatedDatabase(); t.after(() => fixture.close());
  const user = await member(fixture);
  for (const [plan, days] of [['week', 7], ['month', 30]] as const) {
    const order = await fixture.ordering.create(user.id, intent({ plan }));
    const number = order.numbers[0]!;
    assert.equal(Date.parse(number.expiresAt) - Date.parse(number.assignedAt), days * 86400000);
    const route = await routeFor(fixture, number.id);
    const sync = new ReceivingSync(fixture.db, new MockReceivingProvider());
    const externalNumberId = plan === 'week' ? '108' : '109';
    await sync.bindMockNumber(number.id, { externalNumberId, phoneNumber: number.phoneNumber, iccid: null, status: 'ACTIVE', resourceExpiresAt: '2099-01-01T00:00:00Z' });
    const wire = inbound(number.phoneNumber, { numberId: Number(externalNumberId) });
    await sync.receiveMock(route, mapPingCodeInbound(wire));
    const before = await snapshot(fixture, user.id);
    await fixture.db.transaction(async client => {
      await client.query("UPDATE number_allocations SET assigned_at=now()-interval '40 days',expires_at=now()-interval '1 second' WHERE id=$1", [route.allocationId]);
      // Advance the isolated fixture's dates without simulating a release/reallocation.
      await client.query('ALTER TABLE phone_numbers DISABLE TRIGGER phone_number_allocation');
      await client.query("UPDATE phone_numbers SET assigned_at=now()-interval '40 days',expires_at=now()-interval '1 second' WHERE id=$1", [number.id]);
      await client.query('ALTER TABLE phone_numbers ENABLE TRIGGER phone_number_allocation');
    });
    const numbers = await fixture.workspace.numbers(user.id, { page: 1, pageSize: 20, search: '', status: 'EXPIRED' });
    assert.equal(numbers.data.find(row => row.id === number.id)!.status, 'EXPIRED');
    await assert.rejects(sync.receiveMock(route, mapPingCodeInbound(inbound(number.phoneNumber, { numberId: Number(externalNumberId) }))), hasCode('PROVIDER_ALLOCATION_INACTIVE'));
    assert.equal((await sync.receiveMock(route, mapPingCodeInbound(wire))).status, 'DUPLICATE');
    assert.equal((await fixture.workspace.inbox(user.id, { page: 1, pageSize: 20, search: '', numberId: number.id })).pagination.totalItems, 1);
    assert.deepEqual(await snapshot(fixture, user.id), before);
    assert.equal((await fixture.client.query('SELECT assigned_user_id FROM phone_numbers WHERE id=$1', [number.id])).rows[0].assigned_user_id, user.id);
  }
});
