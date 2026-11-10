// Build first. Disposable local PostgreSQL + a local HTTP upstream; never saves the application's .env or calls a real supplier.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { createServer } from 'node:http';
import dotenv from 'dotenv';
import pg from 'pg';

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: resolve(cwd, '.env'), quiet: true });
const base = new URL(process.env.DATABASE_URL), adminUrl = new URL(process.env.ONCE_TEST_ADMIN_URL || base);
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Tests require LOCAL PostgreSQL');
adminUrl.pathname = '/postgres';
if (!process.env.ONCE_TEST_ADMIN_URL && base.hostname === '127.0.0.1' && base.port === '55432' && base.username === 'once') {
  const credentials = JSON.parse(readFileSync(join(homedir(), '.once', 'postgres-dev', 'credentials.json'), 'utf8'));
  adminUrl.username = 'once_admin'; adminUrl.password = credentials.admin;
}
assert(['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname));
const pool = new pg.Pool({ connectionString: adminUrl.toString() }), name = `once_integration_test_${Date.now()}`;
const temporary = mkdtempSync(join(tmpdir(), 'once-integrations-'));
let db, app, upstream, count = 0;
const test = async (label, run) => { await run(); console.log(`PASS ${++count}: ${label}`); };
const rejects = (run, code) => assert.rejects(run, error => !code || error.getResponse?.().code === code);
try {
  await pool.query(`CREATE DATABASE "${name}" OWNER "${decodeURIComponent(base.username).replaceAll('"', '""')}"`);
  const testUrl = new URL(base); testUrl.pathname = `/${name}`;
  process.env.DATABASE_URL = testUrl.toString(); process.env.NODE_ENV = 'test'; process.env.DEMO_MODE = 'true';
  process.env.ONCE_ENV_FILE = join(temporary, '.env');
  writeFileSync(process.env.ONCE_ENV_FILE, '# disposable configuration\nKEEP_ME=preserved\n');
  for (const key of Object.keys(process.env)) if (key.startsWith('PINGCODE_')) delete process.env[key];
  execFileSync(process.execPath, [resolve(cwd, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd, env: process.env, stdio: 'pipe' });
  await import('reflect-metadata');
  const { DbService } = await import('../dist/db.service.js');
  const { settings } = await import('../dist/config.js');
  const { fingerprint } = await import('../dist/business.js');
  const { PingcodeClient } = await import('../dist/pingcode.client.js');
  const { OperatorService } = await import('../dist/operator.service.js');
  const { IntegrationService } = await import('../dist/integration.service.js');
  const { IntegrationController } = await import('../dist/integration.controller.js');
  const { IncomingService, ReceiveWebhookController } = await import('../dist/incoming.service.js');
  const { OutboundService } = await import('../dist/outbound.service.js');
  const { EventsService } = await import('../dist/events.service.js');
  const { AdminService } = await import('../dist/admin.service.js');
  const { AdminController, AdminGuard } = await import('../dist/admin.controller.js');
  const { AuthService, SessionGuard } = await import('../dist/auth.js');
  const { Module } = await import('@nestjs/common');
  const { NestFactory } = await import('@nestjs/core');
  const { default: cookieParser } = await import('cookie-parser');
  db = new DbService(); await db.$connect();
  const pc = new PingcodeClient(), operator = new OperatorService(db, pc), integration = new IntegrationService(db, pc, operator);
  const incoming = new IncomingService(db), outbound = new OutboundService(db, pc), events = new EventsService(db);
  const ops = new AdminService(db, incoming, outbound, events);
  const user = role => db.user.create({ data: { email: `${randomUUID()}@example.test`, passwordHash: 'test-only', role } });
  const actor = await user('ADMIN'), customer = await user('USER');
  let scopes = ['numbers:read', 'sms:read', 'sms:send'], account = 123, badPage = false, numberRows = [{ id: 11, phoneNumber: '+12025550111', status: 'ACTIVE', expiresAt: new Date(Date.now() + 86400000).toISOString() }];
  let requests = 0;
  upstream = createServer((req, res) => {
    requests++; res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer pc_live_disposable_key_123') { res.statusCode = 401; return res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED' } })); }
    if (req.url === '/api/open/v1/me') return res.end(JSON.stringify({ id: account, username: 'test-host', scopes }));
    if (req.url.startsWith('/api/open/v1/numbers?')) return res.end(JSON.stringify({ data: badPage ? [...numberRows, ...numberRows] : numberRows, page: { hasMore: false } }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${upstream.address().port}/api/open/v1`;
  const configuration = { baseUrl, accountId: '123', apiKey: 'pc_live_disposable_key_123', receiveWebhookSecret: 'disposable-receive-secret', reason: '测试接入配置' };
  const command = (action, body, run, key = randomUUID()) => integration.run(actor.id, action, body, key, run);
  class TestModule {}
  Module({ controllers: [IntegrationController, AdminController, ReceiveWebhookController], providers: [AdminGuard, SessionGuard,
    { provide: DbService, useValue: db }, { provide: AuthService, useValue: new AuthService(db) },
    { provide: IntegrationService, useValue: integration }, { provide: AdminService, useValue: ops }, { provide: IncomingService, useValue: incoming }] })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false, rawBody: true }); app.use(cookieParser());
  await app.listen(0, '127.0.0.1'); const root = await app.getUrl();
  async function cookie(u) { const token = randomBytes(32).toString('hex'); await db.session.create({ data: { userId: u.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } }); return 'once_session=' + token; }
  const adminCookie = await cookie(actor), userCookie = await cookie(customer);
  async function http(path, options = {}) { const response = await fetch(root + path, options); return { status: response.status, body: await response.json().catch(() => null) }; }
  const post = (path, body, key = randomUUID()) => http(path, { method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });

  await test('admin integration and event details reject anonymous and ordinary users', async () => {
    for (const path of ['/api/admin/integrations/pingcode', '/api/admin/integrations/pingcode/numbers', '/api/admin/webhooks/summary']) {
      assert.equal((await http(path)).status, 401); assert.equal((await http(path, { headers: { Cookie: userCookie } })).status, 403);
    }
  });
  await test('configuration validates URL, account, keys and reasons without touching environment', async () => {
    await rejects(() => integration.save({ ...configuration, baseUrl: 'file:///tmp/api/open/v1' }), 'VALIDATION_ERROR');
    await rejects(() => integration.save({ ...configuration, accountId: '0' }), 'VALIDATION_ERROR');
    await rejects(() => command('INTEGRATION_CONFIG_UPDATED', { ...configuration, reason: '' }, () => integration.save(configuration)), 'VALIDATION_ERROR');
    assert.equal(readFileSync(process.env.ONCE_ENV_FILE, 'utf8'), '# disposable configuration\nKEEP_ME=preserved\n');
  });
  await test('guarded configuration save preserves other environment variables and never returns secrets', async () => {
    const r = await post('/api/admin/integrations/pingcode', configuration); assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.configured, true); assert.equal(r.body.apiKeyConfigured, true);
    assert(!JSON.stringify(r.body).includes(configuration.apiKey)); assert(!JSON.stringify(r.body).includes(configuration.receiveWebhookSecret));
    const saved = readFileSync(process.env.ONCE_ENV_FILE, 'utf8'); assert(saved.includes('KEEP_ME=preserved')); assert(saved.includes('PINGCODE_BASE_URL='));
    assert.equal(await db.auditLog.count({ where: { action: 'INTEGRATION_CONFIG_UPDATED' } }), 1);
  });
  await test('concurrent integration requests execute once and changed payload cannot reuse a key', async () => {
    let executions = 0; const body = { reason: '并发检测测试' }, key = randomUUID();
    const run = () => command('INTEGRATION_CHECK', body, async () => { executions++; await new Promise(resolve => setTimeout(resolve, 30)); return { ok: true }; }, key);
    const results = await Promise.allSettled([run(), run()]); assert.equal(executions, 1); assert(results.some(r => r.status === 'fulfilled'));
    assert.equal((await run()).ok, true);
    await rejects(() => command('INTEGRATION_CHECK', { reason: '不同内容' }, () => ({ ok: true }), key), 'IDEMPOTENCY_CONFLICT');
  });
  await test('blank secrets preserve stored keys and connection checks validate required scopes', async () => {
    await integration.save({ baseUrl, accountId: '123', apiKey: '', receiveWebhookSecret: '', reason: '保留原有密钥' });
    assert.equal(settings.pingcode.apiKey, configuration.apiKey);
    assert.equal((await integration.check()).ok, true); scopes = ['numbers:read'];
    const partial = await integration.check(); assert.equal(partial.connected, true); assert.deepEqual(partial.missingScopes, ['sms:read', 'sms:send']);
    account = 999; assert.equal((await integration.check()).code, 'PC_OPERATOR_ACCOUNT_MISMATCH'); account = 123; scopes = ['numbers:read', 'sms:read', 'sms:send'];
    settings.pingcode.apiKey = 'wrong-disposable-key'; assert.equal((await integration.check()).connected, false); settings.pingcode.apiKey = configuration.apiKey; pc.resetAccountCheck();
  });
  await test('number preview does not import, allocate or purchase resources', async () => {
    const preview = await integration.numbers(); assert.equal(preview.items.length, 1); assert.equal(preview.items[0].imported, false);
    assert.equal(await db.phoneNumber.count(), 0); assert.equal(await db.lease.count(), 0); assert.equal(await db.order.count(), 0);
  });
  const at = new Date().toISOString(), payload = { eventId: 'test-receive-1', event: 'sms.received', occurredAt: at, data: { messageId: 'IN-test-1', numberId: 11, phoneNumber: '+12025550111', from: 'Test', content: 'disposable message' } };
  let eventId;
  await test('unmatched inbound event is traceable, filterable and retryable', async () => {
    await incoming.receive(payload); const row = await db.webhookEvent.findFirstOrThrow(); eventId = row.id;
    assert.equal(row.status, 'UNMATCHED'); assert.equal(await db.webhookAttempt.count({ where: { eventId } }), 1);
    const list = await ops.list('webhooks', { status: 'UNMATCHED', provider: 'pingcode', eventType: 'sms.received' });
    assert.equal(list.totalItems, 1); assert.equal(list.items[0].retryable, true); assert(!('payload' in list.items[0]));
    assert.equal((await ops.list('webhooks', { eventType: 'sms.send.status_changed' })).totalItems, 0);
    await rejects(() => ops.list('webhooks', { from: 'invalid-date' }), 'VALIDATION_ERROR');
    assert.equal((await ops.webhookSummary()).counts.UNMATCHED, 1);
  });
  await test('missing metadata and malformed upstream pages make no partial import', async () => {
    await rejects(() => integration.sync({ rows: [{ numberId: 11 }] }));
    badPage = true; await rejects(() => integration.sync({ rows: [] })); badPage = false;
    assert.equal(await db.phoneNumber.count(), 0);
  });
  await test('explicit regional import remains held and upstream identity cannot be silently changed', async () => {
    const result = await integration.sync({ rows: [{ numberId: 11, countryCode: 'US', countryName: '美国', regionId: 'dc', regionName: '华盛顿' }] });
    assert.equal(result.imported, 1); const phone = await db.phoneNumber.findFirstOrThrow(); assert(phone.holdReason); assert.equal(phone.occupied, false);
    assert.equal((await integration.numbers()).items[0].imported, true);
    await rejects(() => integration.save({ ...configuration, accountId: '456' }), 'INTEGRATION_IDENTITY_LOCKED');
    await rejects(() => integration.save({ ...configuration, baseUrl: baseUrl.replace('127.0.0.1', 'localhost') }), 'INTEGRATION_IDENTITY_LOCKED');
  });
  await test('manual retry reattributes to historical lease and replay never duplicates SMS', async () => {
    const phone = await db.phoneNumber.findFirstOrThrow();
    await db.$transaction(async tx => { await tx.phoneNumber.update({ where: { id: phone.id }, data: { occupied: true, holdReason: null } }); await tx.lease.create({ data: { userId: customer.id, phoneNumberId: phone.id, termDays: 1, priceMinor: 0, startedAt: new Date(Date.now() - 60000), expiresAt: new Date(Date.now() + 3600000) } }); });
    const key = randomUUID(), body = { reason: '完成号码映射后重新处理' };
    const r = await post(`/api/admin/webhooks/${eventId}/retry`, body, key); assert.equal(r.status, 201); assert.equal(r.body.status, 'PROCESSED', JSON.stringify(r.body));
    const again = await post(`/api/admin/webhooks/${eventId}/retry`, body, key); assert.equal(again.body.status, 'PROCESSED');
    assert.equal(await db.message.count(), 1); assert.equal(await db.auditLog.count({ where: { action: 'WEBHOOK_RETRY' } }), 1);
    assert.equal((await ops.webhookDetail(eventId)).history.filter(row => row.source === 'ADMIN').length, 1);
    await rejects(() => ops.retryWebhook(actor.id, eventId, { reason: '不同请求' }, key), 'IDEMPOTENCY_CONFLICT');
  });
  await test('event time outside a lease is not delivered to the current customer', async () => {
    const other = { ...payload, eventId: 'test-old-event', occurredAt: new Date(Date.now() - 3600000).toISOString(), data: { ...payload.data, messageId: 'IN-old' } };
    await incoming.receive(other); const row = await db.webhookEvent.findFirstOrThrow({ where: { eventId: other.eventId } });
    assert.equal(row.status, 'UNMATCHED'); assert.equal(await db.message.count(), 1);
    await db.webhookEvent.update({ where: { id: row.id }, data: { attempts: 20 } }); assert.equal((await ops.webhookDetail(row.id)).retryExhausted, true);
  });
  await test('same event ID with changed content records a conflict without overwriting original SMS', async () => {
    await assert.rejects(() => incoming.receive({ ...payload, data: { ...payload.data, content: 'conflicting text' } }));
    const row = await db.webhookEvent.findUniqueOrThrow({ where: { id: eventId } }); assert.equal(row.conflictCount, 1); assert.equal(row.payloadHash, fingerprint(payload)); assert.equal(await db.message.count(), 1);
  });
  await test('signed callback is accepted; bad signature is rejected before persistence', async () => {
    const body = JSON.stringify({ ...payload, eventId: 'signed-receive', data: { ...payload.data, messageId: 'IN-signed' } }), timestamp = String(Math.floor(Date.now() / 1000));
    const headers = { 'Content-Type': 'application/json', 'x-pingcode-event-id': 'signed-receive', 'x-pingcode-timestamp': timestamp, 'x-pingcode-signature': 'sha256=' + createHmac('sha256', configuration.receiveWebhookSecret).update(timestamp + '.' + body).digest('hex') };
    assert.equal((await http('/api/webhooks/pingcode/receive', { method: 'POST', headers, body })).status, 204);
    headers['x-pingcode-signature'] = 'sha256=' + '0'.repeat(64); assert.equal((await http('/api/webhooks/pingcode/receive', { method: 'POST', headers, body })).status, 401);
    assert.equal(await db.webhookEvent.count({ where: { eventId: 'signed-receive' } }), 1);
  });
  await test('unmatched outbound receipts have durable processing history', async () => {
    const body = { eventId: 'receipt-1', event: 'sms.send.status_changed', occurredAt: new Date().toISOString(), data: { messageId: 'OUT-77', senderNumberId: 11, senderPhoneNumber: '+12025550111', recipient: '+12025550199', status: 'DELIVERED' } };
    const row = await db.webhookEvent.create({ data: { provider: 'pingcode', providerAccountId: '123', eventId: body.eventId, payload: body, payloadHash: fingerprint(body) } });
    await outbound.processReceipt(row.id); assert.equal((await ops.webhookDetail(row.id)).status, 'UNMATCHED'); assert.equal((await ops.webhookDetail(row.id)).history.length, 1);
  });
  await test('different-key concurrent retries claim one event only once', async () => {
    const body = { ...payload, eventId: 'retry-race', occurredAt: new Date(Date.now() - 3600000).toISOString(), data: { ...payload.data, messageId: 'IN-race' } };
    await incoming.receive(body); const row = await db.webhookEvent.findFirstOrThrow({ where: { eventId: body.eventId } });
    const original = incoming.process.bind(incoming);
    incoming.process = async (...args) => { await new Promise(resolve => setTimeout(resolve, 80)); return original(...args); };
    try {
      const results = await Promise.allSettled([ops.retryWebhook(actor.id, row.id, { reason: '并发人工重试' }, randomUUID()), ops.retryWebhook(actor.id, row.id, { reason: '并发人工重试' }, randomUUID())]);
      assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
      assert.equal((await ops.webhookDetail(row.id)).history.filter(value => value.source === 'ADMIN').length, 1);
    } finally { incoming.process = original; }
  });
  await test('active retry claims reject reentry; expired claims are recoverable', async () => {
    const row = await db.webhookEvent.findFirstOrThrow({ where: { eventId: 'retry-race' } });
    await db.webhookEvent.update({ where: { id: row.id }, data: { status: 'PROCESSING', nextAttemptAt: new Date(Date.now() + 120000) } });
    await rejects(() => ops.retryWebhook(actor.id, row.id, { reason: '检查处理中保护' }, randomUUID()), 'WEBHOOK_NOT_RETRYABLE');
    await db.webhookEvent.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    assert.equal((await ops.retryWebhook(actor.id, row.id, { reason: '恢复超时的重试' }, randomUUID())).status, 'UNMATCHED');
  });
  await test('manual retry cannot bypass payload integrity or switch upstream accounts', async () => {
    const body = { ...payload, eventId: 'tampered', data: { ...payload.data, messageId: 'IN-tampered' } };
    const row = await db.webhookEvent.create({ data: { provider: 'pingcode', providerAccountId: '123', eventId: body.eventId, payload: body, payloadHash: 'bad-hash', status: 'FAILED' } });
    const result = await ops.retryWebhook(actor.id, row.id, { reason: '检查内容完整性' }, randomUUID()); assert.equal(result.status, 'QUARANTINED');
    assert.equal((await ops.webhookDetail(row.id)).lastError, 'INVALID_RECEIVE_EVENT');
    await db.webhookEvent.update({ where: { id: row.id }, data: { providerAccountId: '999' } });
    await rejects(() => ops.retryWebhook(actor.id, row.id, { reason: '阻止跨账号处理' }, randomUUID()), 'WEBHOOK_NOT_RETRYABLE');
  });
  await test('missing upstream resources are marked unavailable without releasing active leases', async () => {
    numberRows = []; const result = await integration.sync({ rows: [] }); assert.equal(result.unavailable, 1);
    const phone = await db.phoneNumber.findFirstOrThrow(); assert.equal(phone.providerStatus, 'UNAVAILABLE'); assert.equal(phone.occupied, true); assert.equal(await db.lease.count(), 1);
  });
  await test('API returns real summaries and audit log includes integration actions without credentials', async () => {
    const summary = await http('/api/admin/webhooks/summary', { headers: { Cookie: adminCookie } }); assert.equal(summary.status, 200); assert(summary.body.counts.PROCESSED >= 1);
    const audit = await ops.list('audit', { status: 'INTEGRATION_CONFIG_UPDATED' }); assert.equal(audit.totalItems, 1); assert(!JSON.stringify(audit).includes(configuration.apiKey)); assert(requests > 0);
  });
  console.log(`\n${count} upstream/webhook integration tests passed; local HTTP stub only.`);
} catch (error) {
  console.error(`FAIL after ${count} tests:`, error.message, error.getResponse?.() ?? '');
  console.error(String(error.stack).split('\n').filter(line => line.includes('test-integrations')).join('\n')); process.exitCode = 1;
} finally {
  if (app) await app.close(); if (db) await db.$disconnect();
  if (upstream) await new Promise(resolve => upstream.close(resolve));
  await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await pool.end(); rmSync(temporary, { recursive: true, force: true });
}
