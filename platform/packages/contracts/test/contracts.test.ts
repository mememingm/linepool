import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  createOrderInputSchema,
  loginInputSchema,
  paginationQuerySchema,
} from '../src/index.js';

describe('shared API contracts', () => {
  it('normalizes a login email at the boundary', () => {
    const result = loginInputSchema.parse({
      email: '  DEMO@LINEPOOL.LOCAL ',
      password: 'demo-password',
    });

    expect(result.email).toBe('demo@linepool.local');
  });

  it('rejects an order without a UUID idempotency key', () => {
    const result = createOrderInputSchema.safeParse({
      projectId: '08ca169f-63e3-4e8c-9b2a-005b8b72ded0',
      planId: '76be33b3-c3f9-46d9-ae18-dfa229886c0e',
      quantity: 1,
      idempotencyKey: 'reused-button-click',
    });

    expect(result.success).toBe(false);
  });

  it('coerces and bounds pagination query values', () => {
    expect(paginationQuerySchema.parse({ page: '2', pageSize: '50' })).toEqual({
      page: 2,
      pageSize: 50,
    });

    expect(
      paginationQuerySchema.safeParse({ page: '0', pageSize: '101' }).success,
    ).toBe(false);
  });

  it('requires one consistent error envelope', () => {
    expect(
      apiErrorSchema.parse({
        error: { code: 'VALIDATION_ERROR', message: '请求参数不正确' },
      }),
    ).toEqual({
      error: { code: 'VALIDATION_ERROR', message: '请求参数不正确' },
    });
  });
});
