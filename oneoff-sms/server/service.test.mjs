import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { openDatabase } from './db.mjs';
import { createService } from './service.mjs';
import { readFileSync } from 'node:fs';
import { MockSmsProvider, PingCodeProvider } from './providers.mjs';

const request = (key = 'purchase-key', productId = 'telegram-us', expectedPriceCents = 120) => ({ productId, expectedPriceCents, idempotencyKey: key });
const hasCode = code => error => error.code === code;
function setup(t, options = {}) {
  const db = openDatabase(); t.after(() => db.close());
  let clock = Date.UTC(2026, 9, 15, 12);
  const service = createService(db, { now: () => clock, adminToken: 'isolated-admin-token', ...options });
  const first = service.bootstrap();
  const viewer = first.data.viewer.id;
  const create = (key, product, price) => service.createTask(viewer, request(key, product, price)).task;
  const sms = (task, overrides = {}) => {
    const assignment = db.prepare('SELECT * FROM assignments WHERE task_id = ?').get(task.id);
    return { provider: 'mock', eventId: `event-${task.id}`, messageId: `message-${task.id}`, resourceId: assignment.resource_id,
      assignmentId: assignment.id, serviceId: db.prepare('SELECT service_id FROM products WHERE id = ?').get(task.productId).service_id,
      text: '[TEST SMS] Verification code: 482913.', occurredAt: new Date(clock).toISOString(), ...overrides };
  };
  return { db, service, first, viewer, create, sms, advance: ms => { clock += ms; }, onlyFirst: () => db.exec("UPDATE resources SET online = CASE WHEN id = 'resource-0' THEN 1 ELSE 0 END") };
}

test('V2 starts empty, with explicit finite capabilities, country-specific inventory and test credits only', t => {
  const { first, service } = setup(t);
  const data = first.data;
  assert.equal(data.version, 3); assert.equal(data.mode, 'demo'); assert.equal(data.provider, 'mock');
  assert.equal(data.tasks.length, 0); const catalog = JSON.parse(readFileSync(new URL('../shared/platforms.json', import.meta.url), 'utf8'));
  assert.equal(data.products.length, catalog.length * 3);
  assert.equal(new Set(data.products.map(p => p.service)).size, catalog.length);
  assert.ok(data.products.filter(p => p.service === 'Airbnb').every(p => p.stock === 0));
  assert.ok(data.products.filter(p => p.countryCode !== 'US').every(p => p.stock === 0));
  assert.ok(data.products.find(p => p.service === 'WeChat' && p.countryCode === 'US').stock < 100);
  assert.equal(data.wallet.balanceCents, 5000); assert.equal(data.wallet.heldCents, 0);
  assert.equal(data.ledger[0].kind, 'TEST_CREDIT'); assert.ok(data.ledger.every(r => r.isTest));
  assert.deepEqual(service.bootstrap(first.token).data, data);
});

test('create atomically reserves credits, snapshots rules, allocates and records the state sequence', t => {
  const { db, service, viewer, create, first } = setup(t);
  const task = create('atomic-create');
  assert.equal(task.status, 'WAITING_SMS'); assert.equal(task.paymentStatus, 'TEST_HELD');
  assert.equal(task.settlementStatus, 'RESERVED'); assert.match(task.phone, /^\+120255501\d{2}$/);
  assert.deepEqual(task.events.map(e => e.state), ['PAYMENT_PENDING', 'ALLOCATING', 'WAITING_SMS']);
  assert.deepEqual(task.messages, []);
  assert.equal(db.prepare('SELECT count(*) AS n FROM usage_history').get().n, 1);
  const snapshot = service.bootstrap(first.token).data;
  assert.equal(snapshot.wallet.balanceCents, 4880); assert.equal(snapshot.wallet.heldCents, 120);
  assert.equal(snapshot.orders[0].taskId, task.id);
  assert.equal(service.getTask(viewer, task.id).rules.blockSameServiceAfterUse, true);
});

test('idempotent create/cancel and conflicting payloads cannot double charge or refund', t => {
  const { service, viewer, db, first } = setup(t);
  const a = service.createTask(viewer, request('idempotent-key'));
  const b = service.createTask(viewer, request('idempotent-key'));
  assert.equal(b.replayed, true); assert.equal(a.task.id, b.task.id);
  assert.throws(() => service.createTask(viewer, request('idempotent-key', 'tiktok-us', 160)), hasCode('IDEMPOTENCY_CONFLICT'));
  assert.equal(service.cancelTask(viewer, a.task.id).task.settlementStatus, 'TEST_REFUNDED');
  assert.equal(service.cancelTask(viewer, a.task.id).replayed, true);
  assert.equal(db.prepare("SELECT count(*) AS n FROM wallet_transactions WHERE kind = 'REFUND'").get().n, 1);
  assert.equal(service.bootstrap(first.token).data.wallet.balanceCents, 5000);
});

test('no stock, incorrect country, disabled service, stale price and insufficient balance roll back', t => {
  const { service, viewer, db } = setup(t);
  for (const [body, code] of [
    [request('wrong-country', 'telegram-gb', 150), 'OUT_OF_STOCK'],
    [request('wrong-price', 'telegram-us', 1), 'PRICE_CHANGED'],
    [request('missing-product', 'missing'), 'PRODUCT_UNAVAILABLE'],
    [{ ...request('extra-fields'), quantity: 2 }, 'INVALID_INPUT'],
  ]) assert.throws(() => service.createTask(viewer, body), hasCode(code));
  db.exec("UPDATE services SET enabled = 0 WHERE id = 'telegram'");
  assert.throws(() => service.createTask(viewer, request('disabled-service')), hasCode('PRODUCT_UNAVAILABLE'));
  db.exec("UPDATE services SET enabled = 1 WHERE id = 'telegram'; UPDATE wallets SET balance_cents = 0");
  assert.throws(() => service.createTask(viewer, request('insufficient-test')), hasCode('INSUFFICIENT_BALANCE'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM tasks').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM idempotency').get().n, 0);
});

test('same number reuses across platforms only after global cooldown; same platform remains blocked', t => {
  const { service, viewer, create, sms, onlyFirst, advance, db } = setup(t);
  onlyFirst();
  const first = create('first-telegram');
  assert.equal(service.receiveSms(sms(first)).status, 'MATCHED');
  assert.throws(() => create('before-cooldown', 'wechat-us', 210), hasCode('OUT_OF_STOCK'));
  advance(61_000);
  assert.throws(() => create('repeat-telegram'), hasCode('OUT_OF_STOCK'));
  const next = create('next-wechat', 'wechat-us', 210);
  assert.equal(next.phone, first.phone);
  assert.deepEqual(service.getTask(viewer, next.id).messages, []);
  assert.equal(db.prepare('SELECT count(*) AS n FROM usage_history WHERE resource_id = ?').get('resource-0').n, 2);
});

test('same-number cross-platform concurrent occupancy is blocked by allocator and database index', t => {
  const { create, db, onlyFirst, service, viewer } = setup(t); onlyFirst();
  const a = create('exclusive-first');
  assert.throws(() => create('exclusive-wechat', 'wechat-us', 210), hasCode('OUT_OF_STOCK'));
  const second = service.bootstrap();
  assert.throws(() => service.createTask(second.data.viewer.id, request('other-customer', 'tiktok-us', 160)), hasCode('OUT_OF_STOCK'));
  assert.equal(service.getTask(viewer, a.id).status, 'WAITING_SMS');
  assert.throws(() => db.prepare('INSERT INTO assignments (id,resource_id,task_id,started_at) VALUES (?,?,?,?)').run('conflict', 'resource-0', a.id, 1), /UNIQUE/);
});

test('matched SMS settles once; three repeated events cannot duplicate messages or revenue', t => {
  const { create, sms, service, viewer, db, first } = setup(t);
  const task = create('receive-success'); const event = sms(task);
  assert.equal(service.receiveSms(event).status, 'MATCHED');
  assert.equal(service.receiveSms(event).replayed, true); assert.equal(service.receiveSms(event).replayed, true);
  assert.equal(service.receiveSms({ ...event, eventId: 'retry-delivery-same-message' }).replayed, true);
  const result = service.getTask(viewer, task.id);
  assert.equal(result.status, 'COMPLETED'); assert.equal(result.messages[0].code, '482913');
  assert.equal(result.paymentStatus, 'TEST_PAID'); assert.equal(result.settlementStatus, 'TEST_SETTLED');
  assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get().n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM wallet_transactions WHERE kind = 'CAPTURE'").get().n, 1);
  assert.equal(service.bootstrap(first.token).data.wallet.heldCents, 0);
  assert.equal(service.adminSnapshot().stats.revenueCents, 120);
  assert.throws(() => service.receiveSms({ ...event, text: 'Different code 999999' }), hasCode('EVENT_CONFLICT'));
});

test('wrong service, missing correlation, pre-window, future and ambiguous SMS are quarantined', t => {
  const { create, sms, service, viewer, advance } = setup(t);
  const task = create('match-boundaries'); advance(1000);
  const cases = [
    { serviceId: 'wechat' }, { assignmentId: '' }, { occurredAt: new Date(Date.parse(task.createdAt) - 1).toISOString() },
    { occurredAt: new Date(Date.parse(task.createdAt) + 100_000).toISOString() }, { text: 'Two codes 123456 and 654321' },
  ];
  cases.forEach((value, i) => assert.equal(service.receiveSms(sms(task, { eventId: `bad-event-${i}`, messageId: `bad-msg-${i}`, ...value })).status, 'QUARANTINED'));
  assert.equal(service.getTask(viewer, task.id).messages.length, 0);
  assert.equal(service.getTask(viewer, task.id).status, 'WAITING_SMS');
  assert.equal(service.adminSnapshot().exceptions.length, cases.length);
});

test('old and late SMS do not leak to another customer after number reuse', t => {
  const { create, sms, service, viewer, onlyFirst, advance } = setup(t); onlyFirst();
  const old = create('old-order-key'); const delayed = sms(old);
  service.cancelTask(viewer, old.id); advance(61_000);
  const other = service.bootstrap();
  const next = service.createTask(other.data.viewer.id, request('new-owner-key', 'wechat-us', 210)).task;
  assert.equal(old.phone, next.phone);
  assert.equal(service.receiveSms({ ...delayed, occurredAt: next.createdAt }).status, 'QUARANTINED');
  assert.equal(service.getTask(other.data.viewer.id, next.id).messages.length, 0);
  assert.throws(() => service.getTask(other.data.viewer.id, old.id), hasCode('TASK_NOT_FOUND'));
  assert.throws(() => service.cancelTask(other.data.viewer.id, old.id), hasCode('TASK_NOT_FOUND'));
  assert.throws(() => service.feedback(other.data.viewer.id, old.id, { message: 'foreign' }), hasCode('TASK_NOT_FOUND'));
});

test('expiry refunds test hold once, releases resource, and records outcome without fabricating SMS', t => {
  const { create, service, viewer, advance, first, db } = setup(t);
  const task = create('expiry-order'); advance(1_201_000); service.expire(); service.expire();
  const result = service.getTask(viewer, task.id);
  assert.equal(result.status, 'EXPIRED'); assert.equal(result.settlementStatus, 'TEST_REFUNDED'); assert.deepEqual(result.messages, []);
  assert.equal(service.bootstrap(first.token).data.wallet.balanceCents, 5000);
  assert.equal(db.prepare('SELECT count(*) AS n FROM assignments WHERE ended_at IS NULL').get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM wallet_transactions WHERE kind = 'REFUND'").get().n, 1);
});

test('provider allocation failure is a traceable failed order with one refund, not successful allocation', t => {
  class FailedProvider extends MockSmsProvider { assertResource() { throw new Error('allocation failed'); } }
  const { create, service, first, db } = setup(t, { provider: new FailedProvider() });
  const task = create('provider-failure');
  assert.equal(task.status, 'ALLOCATION_FAILED'); assert.equal(task.phone, null);
  assert.equal(task.settlementStatus, 'TEST_REFUNDED'); assert.equal(service.bootstrap(first.token).data.wallet.balanceCents, 5000);
  assert.equal(db.prepare('SELECT count(*) AS n FROM assignments').get().n, 0);
});

test('captured cancellation/refund policy survives later admin edits; manual settlement requires reason', t => {
  const { create, service, viewer, first } = setup(t);
  service.updateProduct('test-admin', 'telegram-us', { rules: { refundOnCancel: false }, priceCents: 125 });
  const task = create('policy-snapshot', 'telegram-us', 125);
  service.updateProduct('test-admin', 'telegram-us', { rules: { refundOnCancel: true } });
  const ended = service.cancelTask(viewer, task.id).task;
  assert.equal(ended.settlementStatus, 'REVIEW_REQUIRED'); assert.equal(ended.rules.refundOnCancel, false);
  assert.throws(() => service.resolveSettlement('test-admin', task.id, { action: 'REFUND', reason: '' }), hasCode('CANNOT_SETTLE'));
  service.resolveSettlement('test-admin', task.id, { action: 'REFUND', reason: 'Test operator approved refund; ticket LOCAL-1.' });
  assert.equal(service.bootstrap(first.token).data.wallet.balanceCents, 5000);
  assert.throws(() => service.resolveSettlement('test-admin', task.id, { action: 'REFUND', reason: 'repeat' }), hasCode('CANNOT_SETTLE'));
  assert.ok(service.adminSnapshot().audit.some(e => e.action === 'SETTLEMENT_RESOLVED'));
});

test('test credit grants are explicit, persisted and idempotent, never real payment confirmations', t => {
  const { service, viewer, first } = setup(t);
  const body = { amountCents: 1000, idempotencyKey: 'topup-test-key' };
  assert.equal(service.topUp(viewer, body).isTest, true);
  assert.equal(service.topUp(viewer, body).replayed, true);
  assert.throws(() => service.topUp(viewer, { ...body, amountCents: 2000 }), hasCode('IDEMPOTENCY_CONFLICT'));
  assert.equal(service.bootstrap(first.token).data.wallet.balanceCents, 6000);
  assert.throws(() => service.topUp(viewer, { ...body, amountCents: -100 }), hasCode('INVALID_INPUT'));
});

test('admin token is separate, expires, and configuration changes are validated and audited', t => {
  const { service, advance, create } = setup(t);
  assert.throws(() => service.loginAdmin({ token: 'wrong' }), hasCode('ADMIN_REQUIRED'));
  const admin = service.loginAdmin({ token: 'isolated-admin-token' });
  assert.equal(service.requireAdmin(admin.token), 'local-admin');
  assert.throws(() => service.updateProduct('admin', 'telegram-us', { rules: { cooldownSeconds: -1 } }), hasCode('INVALID_INPUT'));
  service.updateService('local-admin', 'tiktok', { enabled: false });
  service.updateResource('local-admin', 'resource-0', { online: false });
  const task = create('admin-sms-test');
  assert.equal(service.adminMockSms('local-admin', { taskId: task.id, code: '123456' }).status, 'MATCHED');
  assert.ok(service.adminSnapshot().audit.some(e => e.action === 'MOCK_SMS'));
  advance(3_600_001); assert.throws(() => service.requireAdmin(admin.token), hasCode('ADMIN_REQUIRED'));
});

test('SSE service subscriptions receive only their customer events and unsubscribe cleanly', t => {
  const { service, viewer, create } = setup(t);
  const other = service.bootstrap(); let mine = 0; let theirs = 0;
  const stop = service.subscribe(viewer, () => mine++);
  const stopOther = service.subscribe(other.data.viewer.id, () => theirs++);
  create('subscription-key'); assert.equal(mine, 1); assert.equal(theirs, 0);
  stop(); create('subscription-key2'); assert.equal(mine, 1); stopOther();
});

test('restart preserves session, rules, orders, test balances, feedback and migration version', () => {
  const directory = mkdtempSync(join(tmpdir(), 'once-v2-')); const path = join(directory, 'test.sqlite'); let db;
  try {
    db = openDatabase(path); let service = createService(db); const first = service.bootstrap();
    const task = service.createTask(first.data.viewer.id, request('persistent-key')).task;
    service.preferences(first.data.viewer.id, { theme: 'dark' }); service.feedback(first.data.viewer.id, task.id, { message: 'Stored test feedback' });
    db.close(); db = openDatabase(path); service = createService(db);
    const reopened = service.bootstrap(first.token);
    assert.equal(reopened.isNew, false); assert.equal(reopened.data.tasks[0].id, task.id);
    assert.equal(reopened.data.wallet.balanceCents, 4880); assert.equal(reopened.data.preferences.theme, 'dark');
    assert.equal(db.prepare('SELECT count(*) AS n FROM feedback').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version = 2').get().n, 1);
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('unconfigured PingCode fails closed and never reports sellable inventory', t => {
  const { service, viewer, first } = setup(t, { provider: new PingCodeProvider() });
  assert.ok(first.data.products.every(p => p.stock === 0));
  assert.throws(() => service.createTask(viewer, request('pingcode-disabled')), hasCode('PROVIDER_UNAVAILABLE'));
});

test('administrator platform creation cannot invent capabilities and successful use cannot be reset', t => {
  const { service, create, sms, db } = setup(t);
  service.createPlatform('test-admin', { id: 'new-service', name: 'New Service', priceCents: 190 });
  const products = service.adminSnapshot().products.filter(p => p.serviceId === 'new-service');
  assert.equal(products.length, 3); assert.ok(products.every(p => p.stock === 0));
  assert.throws(() => service.createPlatform('test-admin', { id: 'new-service', name: 'New Service', priceCents: 190 }), hasCode('SERVICE_EXISTS'));
  service.updateNumberService('test-admin', 'resource-0', 'new-service', { state: 'AVAILABLE', reason: 'Explicitly verified local mock resource.' });
  assert.equal(service.adminSnapshot().products.find(p => p.id === 'new-service-us').stock, 1);
  assert.equal(service.adminSnapshot().products.find(p => p.id === 'new-service-ca').stock, 0);
  service.updateProduct('test-admin', 'telegram-us', { rules: { blockSameServiceAfterUse: false } });
  const task = create('successful-use-restricted');
  const assignment = db.prepare('SELECT * FROM assignments WHERE task_id = ?').get(task.id);
  assert.throws(() => service.updateNumberService('test-admin', assignment.resource_id, 'new-service', { state: 'RESTRICTED', reason: 'No editing a busy number.' }), hasCode('RESOURCE_BUSY'));
  service.receiveSms(sms(task));
  assert.equal(db.prepare('SELECT state FROM number_services WHERE resource_id = ? AND service_id = ?').get(assignment.resource_id, 'telegram').state, 'USED');
  assert.throws(() => service.updateNumberService('test-admin', assignment.resource_id, 'telegram', { state: 'AVAILABLE', reason: 'Attempt to erase history.' }), hasCode('REUSE_RESTRICTED'));
});

test('manual failure refunds at most once, creates history and leaves the original state intact on retry', t => {
  const { service, create, viewer, db, first } = setup(t);
  const task = create('admin-fail-once');
  service.failTask('test-admin', task.id, { reason: 'Mock transport returned a confirmed failure.' });
  const ended = service.getTask(viewer, task.id);
  assert.equal(ended.status, 'SMS_FAILED'); assert.equal(ended.settlementStatus, 'TEST_REFUNDED');
  assert.equal(service.bootstrap(first.token).data.wallet.balanceCents, 5000);
  assert.throws(() => service.failTask('test-admin', task.id, { reason: 'Repeated handling.' }), hasCode('ORDER_NOT_ACTIVE'));
  assert.equal(db.prepare("SELECT count(*) AS n FROM wallet_transactions WHERE kind = 'REFUND'").get().n, 1);
  assert.equal(db.prepare("SELECT outcome FROM usage_history WHERE task_id = ?").get(task.id).outcome, 'SMS_FAILED');
});

test('actual worker-thread SQLite contention cannot allocate the same number twice', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'once-v2-concurrent-')); const path = join(directory, 'test.sqlite');
  const db = openDatabase(path); const service = createService(db);
  const viewers = [service.bootstrap().data.viewer.id, service.bootstrap().data.viewer.id];
  db.exec("UPDATE resources SET online = CASE WHEN id = 'resource-0' THEN 1 ELSE 0 END");
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const source = `import {parentPort,workerData} from 'node:worker_threads';
    import {openDatabase} from ${JSON.stringify(new URL('./db.mjs', import.meta.url).href)};
    import {createService} from ${JSON.stringify(new URL('./service.mjs', import.meta.url).href)};
    const db=openDatabase(workerData.path); const service=createService(db); parentPort.postMessage('ready');
    parentPort.once('message',()=>{try{parentPort.postMessage({task:service.createTask(workerData.viewer,workerData.request).task.id});}
    catch(e){parentPort.postMessage({error:e.code});}finally{db.close();parentPort.close();}});`;
  const workers = viewers.map((viewer, i) => new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), { workerData: { path, viewer, request: request(`thread-key-${i}`) } }));
  await Promise.all(workers.map(w => new Promise((resolve, reject) => { w.once('message', resolve); w.once('error', reject); })));
  const results = await Promise.all(workers.map(w => new Promise((resolve, reject) => { w.once('message', resolve); w.once('error', reject); w.postMessage('go'); })));
  await Promise.all(workers.map(w => new Promise(resolve => w.threadId === -1 ? resolve() : w.once('exit', resolve))));
  assert.equal(results.filter(r => r.task).length, 1); assert.equal(results.filter(r => r.error === 'OUT_OF_STOCK').length, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM assignments WHERE ended_at IS NULL').get().n, 1);
});
