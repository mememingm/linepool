import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertTestConnection, validateTestAdmin, validateTestDatabase, validateTestSchema } from '../src/test-database.js';

const url = 'postgresql://test_owner:fixture@127.0.0.1:5433/linepool_isolated_test';
const variables = { TEST_DATABASE_URL: url, DATABASE_URL: 'postgresql://business:fixture@127.0.0.1:5433/linepool_react' };

test('test target rejects missing, business, default-port, 5432, remote and option-overridden URLs', () => {
  for (const TEST_DATABASE_URL of [undefined, 'invalid', url.replace('_test', ''), url.replace(':5433', ''), url.replace(':5433', ':5432'), url.replace(':5433', ':0'), url.replace('127.0.0.1', 'remote.example.invalid'), `${url}?host=remote`, `${url}#fragment`, url.replace('linepool_isolated_test', 'linepool%5fisolated_test')]) {
    assert.throws(() => validateTestDatabase({ ...variables, TEST_DATABASE_URL }));
  }
  assert.throws(() => validateTestDatabase({ ...variables, NODE_ENV: 'production' }));
  assert.throws(() => validateTestDatabase({ ...variables, DATABASE_URL: url.replace('test_owner:fixture@127.0.0.1', 'other:other@localhost') }));
  assert.throws(() => validateTestDatabase({ ...variables, DATABASE_URL: url.replace('linepool_isolated_test', 'linepool%5fisolated_test') }));
  const target = validateTestDatabase(variables);
  assert.equal(target.database, 'linepool_isolated_test');
  assert.equal(target.port, 5433);
});

test('initialization requires a separate maintenance URL on the same test server and explicit confirmation', () => {
  const target = validateTestDatabase(variables);
  const admin = 'postgresql://admin:fixture@localhost:5433/postgres';
  assert.throws(() => validateTestAdmin({ ...variables, TEST_DATABASE_ADMIN_URL: admin }, target));
  assert.throws(() => validateTestAdmin({ ...variables, TEST_DATABASE_ADMIN_URL: url, TEST_DATABASE_CONFIRM: target.database }, target));
  assert.throws(() => validateTestAdmin({ ...variables, TEST_DATABASE_ADMIN_URL: admin.replace('5433', '5432'), TEST_DATABASE_CONFIRM: target.database }, target));
  assert.equal(validateTestAdmin({ ...variables, TEST_DATABASE_ADMIN_URL: admin, TEST_DATABASE_CONFIRM: target.database }, target), admin);
});

test('test schemas cannot inject PostgreSQL options or target public', () => {
  assert.equal(validateTestSchema('lp_test_' + 'a'.repeat(32)), 'lp_test_' + 'a'.repeat(32));
  assert.equal(validateTestSchema(undefined), undefined);
  for (const value of ['public', 'lp_test_;DROP SCHEMA public', 'lp_test_short', 'lp_test_' + 'a'.repeat(32) + ' -c role=admin']) {
    assert.throws(() => validateTestSchema(value));
  }
});

test('connection identity is checked before any test schema or migration write', async () => {
  const target = validateTestDatabase(variables);
  await assertTestConnection(async () => ({ rows: [{ database: target.database, port: 5433 }] }), target);
  await assert.rejects(assertTestConnection(async () => ({ rows: [{ database: 'linepool_react', port: 5433 }] }), target));
  await assert.rejects(assertTestConnection(async () => ({ rows: [{ database: target.database, port: 5432 }] }), target));
});
