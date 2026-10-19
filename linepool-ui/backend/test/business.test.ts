import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { CookieOptions, Request, Response } from 'express';
import type { ExecutionContext } from '@nestjs/common';
import { createOrderInputSchema, registerInputSchema, type User } from '@linepool/contracts';
import { SessionGuard, type SessionRequest } from '../src/authentication.js';
import { ApiFailure } from '../src/http.js';
import { isolatedDatabase } from './isolated-database.js';

type Fixture = Awaited<ReturnType<typeof isolatedDatabase>>;
function responseCapture() {
  const cookies = new Map<string, { value: string; options: CookieOptions }>();
  const cleared: { name: string; path?: string }[] = [];
  const response = {
    cookie(name: string, value: string, options: CookieOptions) { cookies.set(name, { value, options }); return this; },
    clearCookie(name: string, options: CookieOptions) { cleared.push({ name, path: options.path }); return this; },
  } as unknown as Response;
  return { response, cookies, cleared };
}
function sessionRequest(token: string) {
  return { cookies: { linepool_react_session: token } } as unknown as SessionRequest;
}
async function member(fixture: Fixture) {
  const capture = responseCapture();
  const input = registerInputSchema.parse({ email: `member-${randomUUID()}@example.invalid`, password: 'isolated-member-fixture', displayName: 'Test member' });
  const user = await fixture.auth.register(input, capture.response);
  const cookie = capture.cookies.get('linepool_react_session')!;
  return { user, input, cookie, capture };
}
async function credit(fixture: Fixture, user: User, amount = 100) {
  await fixture.db.transaction(async client => {
    await client.query('UPDATE users SET points_balance=$2 WHERE id=$1', [user.id, amount]);
    await client.query("INSERT INTO point_ledger(user_id,type,delta,balance_after,description) VALUES($1,'SEED_CREDIT',$2,$2,'isolated fixture')", [user.id, amount]);
  });
}
const intent = () => createOrderInputSchema.parse({ region: 'us', service: 'Telegram', plan: 'month', quantity: 1, idempotencyKey: randomUUID() });
const hasCode = (code: string, status: number) => (error: unknown) => error instanceof ApiFailure
  && error.getStatus() === status && (error.getResponse() as { error: { code: string } }).error.code === code;
async function snapshot(fixture: Fixture, userId: string) {
  const { rows: [row] } = await fixture.client.query(`SELECT
    (SELECT points_balance FROM users WHERE id=$1) AS balance,
    (SELECT count(*)::int FROM orders WHERE user_id=$1) AS orders,
    (SELECT count(*)::int FROM phone_numbers WHERE assigned_user_id=$1) AS numbers,
    (SELECT count(*)::int FROM phone_numbers WHERE assigned_user_id IS NULL) AS inventory,
    (SELECT count(*)::int FROM point_ledger WHERE user_id=$1) AS ledger,
    (SELECT coalesce(sum(delta),0)::int FROM point_ledger WHERE user_id=$1) AS ledger_total`, [userId]);
  return row;
}

test('registration, login, hashed sessions, expiry, guards and logout', async t => {
  const fixture = await isolatedDatabase();
  t.after(() => fixture.close());
  const registered = await member(fixture);
  assert.equal(registered.user.pointsBalance, 0);
  assert.equal(registered.user.isDemo, false);
  assert.match(registered.cookie.value, /^[a-f0-9]{64}$/);
  assert.equal(registered.cookie.options.httpOnly, true);
  assert.equal(registered.cookie.options.sameSite, 'lax');
  assert.equal(registered.cookie.options.path, '/');
  assert.ok(registered.cookie.options.expires instanceof Date);
  const { rows: [stored] } = await fixture.client.query('SELECT password_hash FROM users WHERE id=$1', [registered.user.id]);
  assert.notEqual(stored!.password_hash, registered.input.password);
  const { rows: [session] } = await fixture.client.query('SELECT token_hash FROM sessions WHERE user_id=$1', [registered.user.id]);
  assert.equal(session!.token_hash, createHash('sha256').update(registered.cookie.value).digest('hex'));
  assert.notEqual(session!.token_hash, registered.cookie.value);
  await assert.rejects(fixture.auth.register(registered.input, responseCapture().response), hasCode('EMAIL_EXISTS', 409));
  await assert.rejects(fixture.auth.login({ ...registered.input, password: 'wrong-password' }, responseCapture().response), hasCode('INVALID_CREDENTIALS', 401));
  await assert.rejects(fixture.auth.login({ email: 'missing@example.invalid', password: registered.input.password }, responseCapture().response), hasCode('INVALID_CREDENTIALS', 401));
  const capture = responseCapture();
  assert.equal((await fixture.auth.login(registered.input, capture.response)).id, registered.user.id);
  const token = capture.cookies.get('linepool_react_session')!.value;
  const request = sessionRequest(token);
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  assert.equal(await new SessionGuard(fixture.auth).canActivate(context), true);
  assert.equal(request.user.id, registered.user.id);
  assert.equal(request.sessionToken, token);
  assert.ok(request.sessionExpiresAt instanceof Date);
  await fixture.auth.logout(request, capture.response);
  assert.deepEqual(capture.cleared, [
    { name: 'linepool_react_session', path: '/api' }, // Old cookie removed on login.
    { name: 'linepool_react_session', path: '/' },
    { name: 'linepool_react_session', path: '/api' },
  ]);
  assert.equal(await fixture.auth.getSession(request), null);
  await assert.rejects(new SessionGuard(fixture.auth).canActivate(context), hasCode('UNAUTHENTICATED', 401));
  await fixture.client.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [registered.user.id]);
  assert.equal(await fixture.auth.getSession(sessionRequest(registered.cookie.value)), null);
  assert.equal(await fixture.auth.getSession({ cookies: {} } as Request), null);
  assert.equal(await fixture.auth.getSession(sessionRequest('invalid-token')), null);
});

test('resources, SMS writes, preferences and points remain owned by the authenticated account', async t => {
  const fixture = await isolatedDatabase();
  t.after(() => fixture.close());
  const alice = await member(fixture);
  const bob = await member(fixture);
  await credit(fixture, alice.user);
  await credit(fixture, bob.user);
  const first = await fixture.ordering.create(alice.user.id, intent());
  const second = await fixture.ordering.create(bob.user.id, intent());
  const aliceSms = randomUUID();
  const bobSms = randomUUID();
  for (const [id, owner, number] of [[aliceSms, alice.user.id, first.numbers[0]!.id], [bobSms, bob.user.id, second.numbers[0]!.id]]) {
    await fixture.client.query("INSERT INTO sms_messages(id,user_id,number_id,sender,body) VALUES($1,$2,$3,'fixture','test message')", [id, owner, number]);
  }
  assert.deepEqual((await fixture.workspace.orders(alice.user.id, { page: 1, pageSize: 20, search: '' })).data.map(order => order.id), [first.id]);
  assert.deepEqual((await fixture.workspace.numbers(alice.user.id, { page: 1, pageSize: 20, search: '' })).data.map(number => number.id), [first.numbers[0]!.id]);
  await assert.rejects(fixture.workspace.orderDetail(bob.user.id, first.id), hasCode('ORDER_NOT_FOUND', 404));
  assert.equal((await fixture.workspace.inbox(alice.user.id, { page: 1, pageSize: 20, search: '', numberId: second.numbers[0]!.id })).pagination.totalItems, 0);
  await assert.rejects(fixture.workspace.markRead(alice.user.id, [aliceSms, bobSms]), hasCode('MESSAGE_NOT_FOUND', 404));
  const unread = await fixture.client.query('SELECT is_read FROM sms_messages WHERE id=ANY($1::uuid[])', [[aliceSms, bobSms]]);
  assert.equal(unread.rows.every(row => !row.is_read), true);
  assert.deepEqual(await fixture.workspace.markRead(alice.user.id, [aliceSms, aliceSms]), { ids: [aliceSms], isRead: true });
  assert.equal((await fixture.workspace.inbox(bob.user.id, { page: 1, pageSize: 20, search: '', unread: 'true' })).pagination.totalItems, 1);
  await fixture.workspace.preferences(alice.user.id, false);
  assert.equal((await fixture.workspace.account(alice.user.id)).preferences.expiryNotice, false);
  assert.equal((await fixture.workspace.account(bob.user.id)).preferences.expiryNotice, true);
  const points = await fixture.workspace.points(alice.user.id, { page: 1, pageSize: 20 });
  assert.equal(points.data.balance, 85);
  assert.equal(points.data.entries.reduce((sum, entry) => sum + entry.delta, 0), 85);
  assert.deepEqual(points.data.entries.filter(entry => entry.referenceId).map(entry => entry.referenceId), [first.id]);
  assert.equal((await fixture.workspace.dashboard(bob.user.id)).unreadMessages, 1);
});

test('same-key concurrent retries debit once, conflict on changed payload and stay scoped per user', async t => {
  const fixture = await isolatedDatabase();
  t.after(() => fixture.close());
  const alice = await member(fixture);
  const bob = await member(fixture);
  await credit(fixture, alice.user);
  await credit(fixture, bob.user);
  const input = intent();
  const orders = await Promise.all(Array.from({ length: 4 }, () => fixture.ordering.create(alice.user.id, input)));
  assert.equal(new Set(orders.map(order => order.id)).size, 1);
  assert.deepEqual(await snapshot(fixture, alice.user.id), { balance: 85, orders: 1, numbers: 1, inventory: 716, ledger: 2, ledger_total: 85 });
  const before = await snapshot(fixture, alice.user.id);
  for (const changed of [{ ...input, quantity: 2 }, { ...input, plan: 'week' as const }, { ...input, region: 'gb' as const }, { ...input, service: 'Google' as const }]) {
    await assert.rejects(fixture.ordering.create(alice.user.id, changed), hasCode('IDEMPOTENCY_CONFLICT', 409));
    assert.deepEqual(await snapshot(fixture, alice.user.id), before);
  }
  // A committed retry must still succeed after the remaining balance changes.
  await fixture.ordering.create(alice.user.id, { ...intent(), quantity: 5 });
  assert.equal((await fixture.workspace.account(alice.user.id)).pointsBalance, 10);
  assert.equal((await fixture.ordering.create(alice.user.id, input)).id, orders[0]!.id);
  const bobOrder = await fixture.ordering.create(bob.user.id, input);
  assert.notEqual(bobOrder.id, orders[0]!.id);
});

test('balance, stock, unavailable offer and late ledger failure roll back the entire transaction', async t => {
  const fixture = await isolatedDatabase();
  t.after(() => fixture.close());
  const account = await member(fixture);
  const input = intent();
  let before = await snapshot(fixture, account.user.id);
  await assert.rejects(fixture.ordering.create(account.user.id, input), hasCode('INSUFFICIENT_POINTS', 409));
  assert.deepEqual(await snapshot(fixture, account.user.id), before);
  await credit(fixture, account.user);
  await fixture.client.query("DELETE FROM phone_numbers WHERE region_id='sg' AND service='Google' AND assigned_user_id IS NULL");
  await fixture.client.query("INSERT INTO phone_numbers(region_id,service,phone_number) VALUES('sg','Google','+6581234599')");
  before = await snapshot(fixture, account.user.id);
  await assert.rejects(fixture.ordering.create(account.user.id, { ...input, region: 'sg', service: 'Google', quantity: 2 }), hasCode('INSUFFICIENT_STOCK', 409));
  assert.deepEqual(await snapshot(fixture, account.user.id), before);
  await fixture.client.query("UPDATE offers SET is_active=false WHERE region_id='de'");
  await assert.rejects(fixture.ordering.create(account.user.id, { ...input, region: 'de' }), hasCode('OFFER_NOT_FOUND', 404));
  assert.deepEqual(await snapshot(fixture, account.user.id), before);
  await fixture.client.query(`CREATE FUNCTION reject_test_debit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.type = 'ORDER_DEBIT' THEN RAISE EXCEPTION 'isolated ledger failure'; END IF; RETURN NEW; END $$`);
  await fixture.client.query('CREATE TRIGGER fail_debit BEFORE INSERT ON point_ledger FOR EACH ROW EXECUTE FUNCTION reject_test_debit()');
  await assert.rejects(fixture.ordering.create(account.user.id, input), /isolated ledger failure/);
  assert.deepEqual(await snapshot(fixture, account.user.id), before);
  await fixture.client.query('DROP TRIGGER fail_debit ON point_ledger');
  assert.equal((await fixture.ordering.create(account.user.id, input)).quantity, 1);
});
