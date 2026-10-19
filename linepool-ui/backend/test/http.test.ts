import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ArgumentsHost, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { loginInputSchema } from '@linepool/contracts';
import { Environment } from '../src/environment.js';
import { ApiErrorFilter, ApiFailure, OriginGuard, SchemaPipe } from '../src/http.js';

function originContext(method: string, origin?: string) {
  const request = { method, headers: { origin } } as Request;
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

test('request validation preserves normalization and emits field issues without input secrets', () => {
  const pipe = new SchemaPipe(loginInputSchema);
  assert.equal(pipe.transform({ email: ' MEMBER@EXAMPLE.INVALID ', password: 'valid-password' }).email, 'member@example.invalid');
  assert.throws(() => pipe.transform({ email: 'invalid', password: 'short' }), (error: unknown) => {
    if (!(error instanceof ApiFailure)) return false;
    assert.equal(error.getStatus(), 400);
    const payload = error.getResponse() as { error: { code: string; details: { path: string; message: string }[] } };
    assert.equal(payload.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(payload.error.details.map(issue => issue.path), ['email', 'password']);
    assert.equal(JSON.stringify(payload).includes('short'), false);
    return true;
  });
});

test('origin guard permits reads and rejects cross-origin or missing-origin writes', () => {
  const environment = { values: { WEB_ORIGIN: 'http://127.0.0.1:5178' } } as Environment;
  const guard = new OriginGuard(environment);
  for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(guard.canActivate(originContext(method)), true);
  for (const method of ['POST', 'PATCH']) {
    assert.equal(guard.canActivate(originContext(method, environment.values.WEB_ORIGIN)), true);
    assert.throws(() => guard.canActivate(originContext(method)), ApiFailure);
    assert.throws(() => guard.canActivate(originContext(method, 'https://other.example.invalid')), ApiFailure);
  }
});

test('error filter preserves API status/code envelope for auth and ownership failures', () => {
  let status: number | undefined;
  let body: unknown;
  const response = { status(value: number) { status = value; return this; }, json(value: unknown) { body = value; return this; } };
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  const filter = new ApiErrorFilter();
  for (const [expectedStatus, code] of [[401, 'UNAUTHENTICATED'], [404, 'ORDER_NOT_FOUND'], [409, 'IDEMPOTENCY_CONFLICT']] as const) {
    filter.catch(new ApiFailure(expectedStatus, code, 'Fixture failure'), host);
    assert.equal(status, expectedStatus);
    assert.deepEqual(body, { error: { code, message: 'Fixture failure' } });
  }
});
