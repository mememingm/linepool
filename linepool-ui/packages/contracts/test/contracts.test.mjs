import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accountSchema, apiErrorSchema, catalogSchema, createOrderInputSchema, dataResponseSchema,
  inboxQuerySchema, listQuerySchema, loginInputSchema, markReadInputSchema, numbersQuerySchema,
  orderDetailSchema, paginationQuerySchema, paginatedResponseSchema, pointsQuerySchema,
  preferencesInputSchema, registerInputSchema, userSchema,
} from '../dist/index.js';

const id = '00000000-0000-4000-8000-000000000001';
const user = { id, email: 'member@example.invalid', displayName: 'Member', isDemo: false, pointsBalance: 0, createdAt: '2026-01-01T00:00:00.000Z', role: 'USER' };
const intent = { region: 'us', service: 'Telegram', plan: 'month', quantity: 1, idempotencyKey: id };

test('login normalizes email, retains password, and rejects unknown fields and oversized UTF-8 passwords', () => {
  const input = loginInputSchema.parse({ email: ' Member@Example.Invalid ', password: ' spaced password ' });
  assert.equal(input.email, user.email);
  assert.equal(input.password, ' spaced password ');
  for (const password of ['short', 'a'.repeat(73), '\u00e9'.repeat(37)]) {
    assert.equal(loginInputSchema.safeParse({ email: user.email, password }).success, false);
  }
  assert.equal(loginInputSchema.safeParse({ email: user.email, password: 'valid-password', admin: true }).success, false);
  assert.equal(registerInputSchema.parse({ ...input, displayName: ' Member ' }).displayName, 'Member');
  assert.equal(registerInputSchema.safeParse({ ...input, displayName: ' ' }).success, false);
});

test('pagination and query schemas preserve coercion, defaults and existing filters', () => {
  assert.deepEqual(paginationQuerySchema.parse({}), { page: 1, pageSize: 20 });
  assert.deepEqual(listQuerySchema.parse({ page: '2', pageSize: '10', search: ' item ' }), { page: 2, pageSize: 10, search: 'item' });
  for (const value of [0, 1.5, 100001]) assert.equal(paginationQuerySchema.safeParse({ page: value }).success, false);
  assert.equal(paginationQuerySchema.safeParse({ pageSize: 101 }).success, false);
  assert.equal(numbersQuerySchema.parse({ status: 'expiring' }).status, 'expiring');
  assert.equal(inboxQuerySchema.parse({ unread: 'false', numberId: id }).unread, 'false');
  assert.equal(inboxQuerySchema.safeParse({ unread: false }).success, false);
  assert.equal(pointsQuerySchema.parse({ kind: 'expense' }).kind, 'expense');
});

test('order intents retain the caller key and reject invalid identifiers, quantities and extra properties', () => {
  assert.deepEqual(createOrderInputSchema.parse(intent), intent);
  for (const quantity of [0, 11, 1.5]) assert.equal(createOrderInputSchema.safeParse({ ...intent, quantity }).success, false);
  for (const field of ['region', 'service', 'plan', 'idempotencyKey']) {
    assert.equal(createOrderInputSchema.safeParse({ ...intent, [field]: field === 'plan' ? 'invalid plan' : 'invalid' }).success, false);
  }
  assert.equal(createOrderInputSchema.safeParse({ ...intent, points: 0 }).success, false);
});

test('response envelopes reject malformed successful data and retain API error details', () => {
  assert.deepEqual(dataResponseSchema(userSchema).parse({ data: user }), { data: user });
  assert.equal(dataResponseSchema(userSchema).safeParse({ data: { ...user, pointsBalance: -1 } }).success, false);
  assert.equal(dataResponseSchema(userSchema).safeParse({ user }).success, false);
  assert.deepEqual(apiErrorSchema.parse({ error: { code: 'CONFLICT', message: 'Conflict', details: { field: 'key' } } }).error.details, { field: 'key' });
  assert.equal(paginatedResponseSchema(userSchema).safeParse({ data: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }).success, true);
  assert.equal(orderDetailSchema.safeParse({ id }).success, false);
});

test('DEMO catalog and account preference semantics stay unchanged', () => {
  assert.equal(catalogSchema.safeParse({ regions: [], services: [], offers: [], isDemo: true }).success, true);
  assert.equal(catalogSchema.safeParse({ regions: [], services: [], offers: [], isDemo: false }).success, false);
  assert.equal(accountSchema.safeParse({ ...user, preferences: { expiryNotice: true, language: 'zh-CN' } }).success, true);
  assert.equal(preferencesInputSchema.safeParse({ expiryNotice: true, language: 'en' }).success, false);
  assert.equal(markReadInputSchema.safeParse({ ids: [] }).success, false);
  assert.equal(markReadInputSchema.safeParse({ ids: Array(101).fill(id) }).success, false);
});
