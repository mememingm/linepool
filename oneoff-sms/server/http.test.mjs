import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { openDatabase } from './db.mjs';
import { createService } from './service.mjs';
import { createHttpServer } from './http.mjs';
import { signWebhook } from './providers.mjs';

async function setup(t) {
  const db = openDatabase();
  const allowedHosts = new Set();
  const service = createService(db, { adminToken: 'http-isolated-admin' });
  const server = createHttpServer(service, { allowedHosts, webhookSecret: 'http-isolated-webhook' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  allowedHosts.add(new URL(base).host);
  const call = async (path, options = {}) => {
    if (options.headers?.Host) {
      return new Promise((resolve, reject) => {
        const req = httpRequest(base + path, options, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString()) }));
        });
        req.on('error', reject);
        req.end(options.body);
      });
    }
    return fetch(base + path, options);
  };
  const bootstrap = await call('/api/bootstrap');
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  return { call, bootstrap, cookie, data: await bootstrap.json(), db, service, base };
}

test('HTTP bootstrap sets a persistent HttpOnly local session and returns only SQLite-backed JSON', async (t) => {
  const { call, bootstrap, cookie, data } = await setup(t);
  assert.equal(bootstrap.status, 200);
  assert.match(bootstrap.headers.get('set-cookie'), /HttpOnly/);
  assert.match(bootstrap.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal(bootstrap.headers.get('access-control-allow-origin'), null);
  const second = await call('/api/bootstrap', { headers: { Cookie: cookie } });
  assert.equal(second.headers.get('set-cookie'), null);
  const reopened = await second.json();
  assert.deepEqual(reopened.viewer, data.viewer);
  assert.deepEqual(reopened.tasks, data.tasks);
  assert.deepEqual(reopened.products, data.products);
});

test('HTTP rejects foreign origins/hosts, non-JSON bodies, malformed JSON, excessive bodies and absent sessions', async (t) => {
  const { call, cookie } = await setup(t);
  const task = { productId: 'telegram-us', expectedPriceCents: 120, idempotencyKey: 'http-test-key' };
  const cases = [
    [{ method: 'POST', headers: { Origin: 'https://evil.invalid', Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(task) }, 403, 'ORIGIN_REJECTED'],
    [{ method: 'POST', headers: { Host: 'evil.invalid', Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(task) }, 403, 'HOST_REJECTED'],
    [{ method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify(task) }, 415, 'JSON_REQUIRED'],
    [{ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{' }, 400, 'INVALID_JSON'],
    [{ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '[]' }, 400, 'INVALID_JSON'],
    [{ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'x'.repeat(9000) }) }, 413, 'BODY_TOO_LARGE'],
    [{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task) }, 401, 'SESSION_REQUIRED'],
  ];
  for (const [options, status, code] of cases) {
    const response = await call('/api/tasks', options);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
  const bootstrap = await call('/api/bootstrap', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(bootstrap.status, 403);
});

test('HTTP create/cancel/feedback/preferences routes expose typed contract and deny foreign task access', async (t) => {
  const { call, cookie, data } = await setup(t);
  const headers = { Cookie: cookie, Origin: 'http://127.0.0.1:5188', 'Content-Type': 'application/json' };
  const payload = { productId: 'telegram-us', expectedPriceCents: 120, idempotencyKey: 'route-test-key' };
  const created = await call('/api/tasks', { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(created.status, 201);
  const result = await created.json();
  assert.equal(result.task.isDemo, true);
  const retry = await call('/api/tasks', { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).task.id, result.task.id);
  const cancel = await call(`/api/tasks/${result.task.id}/cancel`, { method: 'POST', headers, body: '{}' });
  assert.equal((await cancel.json()).task.status, 'CANCELLED');
  const feedback = await call(`/api/tasks/${result.task.id}/feedback`, { method: 'POST', headers, body: JSON.stringify({ message: 'Local only.' }) });
  assert.equal(feedback.status, 201);
  const preference = await call('/api/preferences', { method: 'PATCH', headers, body: JSON.stringify({ theme: 'dark' }) });
  assert.deepEqual(await preference.json(), { preferences: { theme: 'dark' } });
  const other = await call('/api/bootstrap');
  const otherCookie = other.headers.get('set-cookie').split(';')[0];
  for (const [path, method, body] of [
    [`/api/tasks/${result.task.id}`, 'GET', undefined],
    [`/api/tasks/${result.task.id}/cancel`, 'POST', '{}'],
    [`/api/tasks/${result.task.id}/feedback`, 'POST', '{"message":"foreign"}'],
  ]) {
    const response = await call(path, { method, headers: { ...headers, Cookie: otherCookie }, body });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'TASK_NOT_FOUND');
  }
});
