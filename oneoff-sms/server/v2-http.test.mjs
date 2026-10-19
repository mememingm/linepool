import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from './db.mjs';
import { createService } from './service.mjs';
import { createHttpServer } from './http.mjs';
import { signWebhook } from './providers.mjs';

async function setup(t) {
  const db = openDatabase();
  const service = createService(db, { adminToken: 'local-test-admin' });
  const allowedHosts = new Set();
  const server = createHttpServer(service, { allowedHosts, webhookSecret: 'local-test-signing' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`; allowedHosts.add(new URL(base).host);
  t.after(async () => { const done = once(server, 'close'); server.close(); server.closeAllConnections(); await done; db.close(); });
  const call = (path, options) => fetch(base + path, options);
  const bootstrap = await call('/api/bootstrap'); const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  const data = await bootstrap.json();
  const post = (path, body, session = cookie, method = 'POST') => call(path, { method, headers: { Cookie: session, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { db, service, call, post, cookie, data };
}

test('HTTP admin authentication is independent; configuration, platform creation and logout are audited', async t => {
  const { call, post, cookie } = await setup(t);
  assert.equal((await call('/api/admin/snapshot', { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await post('/api/admin/login', { token: 'wrong' })).status, 403);
  const login = await post('/api/admin/login', { token: 'local-test-admin' });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/api\/admin/);
  const admin = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/bootstrap', { headers: { Cookie: admin } })).status, 200);
  assert.equal((await post('/api/admin/products/telegram-us', { priceCents: 175, durationSeconds: 1800 }, admin, 'PATCH')).status, 200);
  assert.equal((await post('/api/admin/services', { id: 'new-http-platform', name: 'HTTP Test Platform', priceCents: 110 }, admin)).status, 201);
  const snapshot = await (await call('/api/admin/snapshot', { headers: { Cookie: admin } })).json();
  assert.equal(snapshot.products.find(p => p.id === 'telegram-us').priceCents, 175);
  assert.ok(snapshot.products.filter(p => p.serviceId === 'new-http-platform').every(p => p.stock === 0));
  assert.ok(snapshot.audit.some(a => a.action === 'SERVICE_CREATE'));
  assert.equal((await post('/api/tasks', { productId: 'telegram-us', expectedPriceCents: 175, idempotencyKey: 'admin-is-not-customer' }, admin)).status, 401);
  assert.equal((await post('/api/admin/logout', {}, admin)).status, 200);
  assert.equal((await call('/api/admin/snapshot', { headers: { Cookie: admin } })).status, 403);
});

test('HTTP webhook signatures, replay protection and unconfigured live provider fail closed', async t => {
  const { call, post, cookie, db } = await setup(t);
  const created = await (await post('/api/tasks', { productId: 'telegram-us', expectedPriceCents: 120, idempotencyKey: 'signed-event-order' })).json();
  const assignment = db.prepare('SELECT * FROM assignments WHERE task_id = ?').get(created.task.id);
  const event = { provider: 'mock', eventId: 'signed-event', messageId: 'signed-message', resourceId: assignment.resource_id,
    assignmentId: assignment.id, serviceId: 'telegram', occurredAt: new Date().toISOString(), text: '[TEST SMS] Code 654321.' };
  const raw = JSON.stringify(event); const timestamp = String(Date.now());
  const headers = { 'Content-Type': 'application/json', 'x-once-timestamp': timestamp, 'x-once-signature': signWebhook('local-test-signing', timestamp, raw) };
  assert.equal((await call('/api/providers/mock/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw })).status, 403);
  const old = String(Date.now() - 400_000);
  assert.equal((await call('/api/providers/mock/webhook', { method: 'POST', headers: { ...headers, 'x-once-timestamp': old, 'x-once-signature': signWebhook('local-test-signing', old, raw) }, body: raw })).status, 403);
  assert.equal((await call('/api/providers/mock/webhook', { method: 'POST', headers, body: raw.replace('654321', '111111') })).status, 403);
  const accepted = await call('/api/providers/mock/webhook', { method: 'POST', headers, body: raw });
  assert.equal(accepted.status, 200); assert.equal((await accepted.json()).status, 'MATCHED');
  for (let i = 0; i < 3; i++) assert.equal((await (await call('/api/providers/mock/webhook', { method: 'POST', headers, body: raw })).json()).replayed, true);
  const result = await (await call(`/api/tasks/${created.task.id}`, { headers: { Cookie: cookie } })).json();
  assert.equal(result.task.messages.length, 1); assert.equal(result.task.messages[0].code, '654321');
  assert.equal(result.task.settlementStatus, 'TEST_SETTLED');
  assert.equal(db.prepare("SELECT count(*) AS n FROM wallet_transactions WHERE kind = 'CAPTURE'").get().n, 1);
  assert.equal((await post('/api/providers/pingcode/webhook', event)).status, 503);
  const other = await call('/api/bootstrap'); const otherCookie = other.headers.get('set-cookie').split(';')[0];
  assert.equal((await call(`/api/tasks/${created.task.id}`, { headers: { Cookie: otherCookie } })).status, 404);
});

test('HTTP SSE sends authenticated invalidations, supports disconnect and fresh reconnection', { timeout: 10_000 }, async t => {
  const { call, post, cookie } = await setup(t);
  assert.equal((await call('/api/events')).status, 401);
  const controller = new AbortController(); t.after(() => controller.abort());
  const stream = await call('/api/events', { headers: { Cookie: cookie }, signal: controller.signal });
  assert.equal(stream.status, 200); assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
  await post('/api/tasks', { productId: 'telegram-us', expectedPriceCents: 120, idempotencyKey: 'sse-order-change' });
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: change\ndata: \{\}/);
  await reader.cancel(); controller.abort();
  const again = new AbortController(); t.after(() => again.abort());
  const reconnect = await call('/api/events', { headers: { Cookie: cookie }, signal: again.signal });
  const next = reconnect.body.getReader(); assert.match(new TextDecoder().decode((await next.read()).value), /event: ready/);
  const snapshot = await (await call('/api/bootstrap', { headers: { Cookie: cookie } })).json();
  assert.equal(snapshot.tasks.length, 1); await next.cancel(); again.abort();
});
