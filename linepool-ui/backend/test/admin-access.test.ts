import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AdminController } from '../src/admin-controller.js';
import { Administration, AdminGuard } from '../src/administration.js';
import { Authentication, SessionGuard } from '../src/authentication.js';
import { AuthController, WorkspaceController } from '../src/controllers.js';
import { ApiErrorFilter, OriginGuard } from '../src/http.js';
import { Ordering } from '../src/ordering.js';
import { Workspace } from '../src/workspace.js';
import { isolatedDatabase } from './isolated-database.js';

// Exercise real controllers, guards and PostgreSQL sessions in an isolated test schema.
test('admin HTTP routes enforce database roles, session expiry, disabled accounts and logout', async t => {
  const fixture = await isolatedDatabase();
  t.after(() => fixture.close());
  @Module({
    controllers: [AuthController, WorkspaceController, AdminController],
    providers: [SessionGuard, AdminGuard,
      { provide: Authentication, useValue: fixture.auth },
      { provide: Administration, useValue: new Administration(fixture.db) },
      { provide: Workspace, useValue: fixture.workspace },
      { provide: Ordering, useValue: fixture.ordering },
    ],
  })
  class AccessTestApplication {}
  const app = await NestFactory.create<NestExpressApplication>(AccessTestApplication, { logger: false });
  t.after(() => app.close());
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalFilters(new ApiErrorFilter());
  app.useGlobalGuards(new OriginGuard(fixture.environment));
  await app.listen(0, '127.0.0.1');
  const origin = fixture.environment.values.WEB_ORIGIN;
  const base = `${await app.getUrl()}/api`;
  const request = (path: string, cookie = '', method = 'GET', body?: object) => fetch(base + path, {
    method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  async function register(label: string) {
    const input = { email: `${label}-${randomUUID()}@example.invalid`, password: 'isolated-access-fixture', displayName: label };
    // The existing strict contract rejects client-supplied privileges before registration.
    assert.equal((await request('/auth/register', '', 'POST', { ...input, role: 'ADMIN' })).status, 400);
    const response = await request('/auth/register', '', 'POST', input);
    assert.equal(response.status, 201);
    const user = (await response.json()).data as { id: string; role: string };
    assert.equal(user.role, 'USER');
    const cookies = response.headers.getSetCookie();
    const root = cookies.find(value => /; Path=\/(?:;|$)/.test(value) && !value.includes('1970'));
    assert.ok(root, 'Login/register must issue a root-path session cookie');
    assert.match(root, /HttpOnly/);
    assert.match(root, /SameSite=Lax/);
    assert.ok(cookies.some(value => value.includes('Path=/api') && value.includes('1970')));
    return { id: user.id, cookie: root.split(';')[0]! };
  }
  const admin = await register('Admin');
  const user = await register('Member');
  await fixture.client.query("UPDATE users SET role='ADMIN' WHERE id=$1", [admin.id]);
  const sampleId = randomUUID();
  const reads = ['/admin/session', '/admin/summary', '/admin/users', '/admin/numbers', '/admin/products',
    '/admin/orders', '/admin/renewals', '/admin/audit'];
  const writes = [
    { path: `/admin/users/${user.id}/status`, method: 'PATCH' },
    { path: `/admin/numbers/${sampleId}/actions`, method: 'POST' },
    { path: '/admin/products', method: 'POST' },
    { path: '/admin/products', method: 'PATCH' },
  ];
  for (const cookie of ['', `linepool_react_session=${'f'.repeat(64)}`]) {
    for (const path of reads) assert.equal((await request(path, cookie)).status, 401, `anonymous ${path}`);
    for (const { path, method } of writes) assert.equal((await request(path, cookie, method, {})).status, 401, `anonymous ${method} ${path}`);
    assert.equal((await request('/account', cookie)).status, 401);
  }
  for (const path of reads) {
    const denied = await request(path, user.cookie);
    assert.equal(denied.status, 403, `member ${path}`);
    assert.equal((await denied.json()).error.code, 'ADMIN_REQUIRED');
    assert.equal((await request(path, admin.cookie)).status, path === '/admin/renewals' ? 400 : 200, `admin ${path}`); // Renewals are intentionally disabled.
  }
  for (const { path, method } of writes) {
    assert.equal((await request(path, user.cookie, method, {})).status, 403, `member ${method} ${path}`);
    assert.equal((await request(path, admin.cookie, method, {})).status, 400, 'Admin reaches input validation');
  }
  for (const section of ['users', 'numbers', 'orders', 'renewals']) {
    assert.equal((await request(`/admin/${section}/${sampleId}`, user.cookie)).status, 403);
  }
  for (const cookie of [admin.cookie, user.cookie]) assert.equal((await request('/account', cookie)).status, 200);
  assert.equal((await (await request('/admin/session', admin.cookie)).json()).data.role, 'ADMIN');

  const before = (await fixture.client.query('SELECT token_hash,expires_at FROM sessions WHERE user_id=$1', [admin.id])).rows;
  const migrated = await request('/auth/me', admin.cookie);
  assert.equal(migrated.status, 200);
  assert.ok(migrated.headers.getSetCookie().some(value => value.includes('Path=/api') && value.includes('1970')));
  assert.ok(migrated.headers.getSetCookie().some(value => /; Path=\/(?:;|$)/.test(value) && !value.includes('1970')));
  assert.deepEqual((await fixture.client.query('SELECT token_hash,expires_at FROM sessions WHERE user_id=$1', [admin.id])).rows, before, 'Cookie migration must not extend the session');

  await fixture.client.query("UPDATE users SET role='USER' WHERE id=$1", [admin.id]);
  assert.equal((await request('/admin/session', admin.cookie)).status, 403, 'Role revocation applies to existing sessions');
  await fixture.client.query("UPDATE users SET account_status='DISABLED' WHERE id=$1", [admin.id]);
  assert.equal((await request('/auth/me', admin.cookie)).status, 401);
  await fixture.client.query("UPDATE users SET account_status='ACTIVE',role='ADMIN' WHERE id=$1", [admin.id]);
  await fixture.client.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [admin.id]);
  assert.equal((await request('/admin/session', admin.cookie)).status, 401, 'Expired administrator session is rejected');
  const logout = await request('/auth/logout', user.cookie, 'POST', {});
  assert.equal(logout.status, 201);
  assert.ok(logout.headers.getSetCookie().some(value => /; Path=\/(?:;|$)/.test(value) && value.includes('1970')));
  assert.ok(logout.headers.getSetCookie().some(value => value.includes('Path=/api') && value.includes('1970')));
  assert.equal((await request('/account', user.cookie)).status, 401, 'Logged-out cookie cannot be reused');
});
