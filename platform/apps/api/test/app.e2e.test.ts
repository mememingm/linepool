import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../scripts/migrate.js';
import { seedDatabase } from '../scripts/seed.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testAccount = {
  email: 'api-test@linepool.local',
  password: 'api-test-password',
  displayName: 'API Test User',
};

describe.skipIf(!testDatabaseUrl)('LINEPOOL API', () => {
  let app: INestApplication;
  let pool: Pool;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const database = new URL(testDatabaseUrl as string).pathname.slice(1);
    if (!database.endsWith('_test')) {
      throw new Error('Refusing to reset a database whose name does not end with _test');
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    pool = new Pool({ connectionString: testDatabaseUrl });
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await runMigrations(pool);
    await seedDatabase(pool, testAccount);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('reports API and database health', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(response.body).toEqual({
      data: { status: 'ok', database: 'ok' },
    });
  });

  it('uses the shared error envelope for unknown routes', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/not-a-route')
      .expect(404);

    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: '请求的资源不存在',
      },
    });
  });

  it('rejects protected resources without a session', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/projects')
      .expect(401);

    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('returns a generic error for invalid credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testAccount.email, password: 'incorrect-password' })
      .expect(401);

    expect(response.body).toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: '邮箱或密码不正确',
      },
    });
  });

  it('creates an HttpOnly session and returns the current public user', async () => {
    const login = await agent
      .post('/api/auth/login')
      .send({ email: testAccount.email.toUpperCase(), password: testAccount.password })
      .expect(201);

    expect(login.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(login.headers['set-cookie']?.[0]).toContain('SameSite=Lax');
    expect(login.body.data).toMatchObject({
      email: testAccount.email,
      displayName: testAccount.displayName,
      isDemo: true,
      pointsBalance: 18800,
    });
    expect(login.body.data).not.toHaveProperty('passwordHash');

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.data.email).toBe(testAccount.email);
  });

  it('returns paginated projects and a plan-backed project detail', async () => {
    const list = await agent
      .get('/api/projects?page=1&pageSize=2')
      .expect(200);

    expect(list.body.pagination).toEqual({
      page: 1,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
    });
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0]).toMatchObject({
      name: '美国验证码',
      availableCount: 5,
      minPoints: 1200,
    });

    const detail = await agent
      .get(`/api/projects/${list.body.data[0].id}`)
      .expect(200);
    expect(detail.body.data.plans).toHaveLength(2);
    expect(detail.body.data.plans[0]).toMatchObject({
      name: '标准验证包',
      availableCount: 5,
    });
  });

  it('returns a user-scoped dashboard summary', async () => {
    const response = await agent.get('/api/dashboard').expect(200);

    expect(response.body.data).toMatchObject({
      pointsBalance: 18800,
      availableProjects: expect.any(Array),
      recentOrders: [
        expect.objectContaining({ orderNumber: 'LP-DEMO-0001' }),
      ],
    });
  });

  it('creates one transactional order and returns the same result for a replay', async () => {
    const input = {
      projectId: '20000000-0000-4000-8000-000000000001',
      planId: '30000000-0000-4000-8000-000000000001',
      quantity: 2,
      idempotencyKey: '80000000-0000-4000-8000-000000000001',
    };

    const first = await agent.post('/api/orders').send(input).expect(201);
    expect(first.body.data).toMatchObject({
      project: { name: '美国验证码' },
      plan: { name: '标准验证包' },
      quantity: 2,
      totalPoints: 2400,
      status: 'COMPLETED',
    });
    expect(first.body.data.numbers).toHaveLength(2);

    const replay = await agent.post('/api/orders').send(input).expect(201);
    expect(replay.body.data.id).toBe(first.body.data.id);

    const state = await pool.query<{
      balance: number;
      order_count: string;
      assigned_count: string;
      debit_count: string;
    }>(`
      SELECT
        (SELECT points_balance FROM users WHERE email = 'api-test@linepool.local') AS balance,
        (SELECT count(*) FROM orders WHERE idempotency_key = '80000000-0000-4000-8000-000000000001')::text AS order_count,
        (SELECT count(*) FROM phone_numbers WHERE assigned_order_id = $1)::text AS assigned_count,
        (SELECT count(*) FROM point_ledger WHERE reference_id = $1)::text AS debit_count
    `, [first.body.data.id]);
    expect(state.rows[0]).toEqual({
      balance: 16400,
      order_count: '1',
      assigned_count: '2',
      debit_count: '1',
    });
  });

  it('rolls back an order when points are insufficient', async () => {
    const before = await pool.query<{ orders: string; balance: number }>(`
      SELECT
        (SELECT count(*) FROM orders)::text AS orders,
        (SELECT points_balance FROM users WHERE email = 'api-test@linepool.local') AS balance
    `);

    const response = await agent
      .post('/api/orders')
      .send({
        projectId: '20000000-0000-4000-8000-000000000001',
        planId: '30000000-0000-4000-8000-000000000002',
        quantity: 10,
        idempotencyKey: '80000000-0000-4000-8000-000000000002',
      })
      .expect(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_POINTS');

    const after = await pool.query<{ orders: string; balance: number }>(`
      SELECT
        (SELECT count(*) FROM orders)::text AS orders,
        (SELECT points_balance FROM users WHERE email = 'api-test@linepool.local') AS balance
    `);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('rolls back an order when inventory is insufficient', async () => {
    const before = await pool.query<{ orders: string; balance: number; available: string }>(`
      SELECT
        (SELECT count(*) FROM orders)::text AS orders,
        (SELECT points_balance FROM users WHERE email = 'api-test@linepool.local') AS balance,
        (SELECT count(*) FROM phone_numbers WHERE project_id = '20000000-0000-4000-8000-000000000002' AND status = 'AVAILABLE')::text AS available
    `);

    const response = await agent
      .post('/api/orders')
      .send({
        projectId: '20000000-0000-4000-8000-000000000002',
        planId: '30000000-0000-4000-8000-000000000003',
        quantity: 6,
        idempotencyKey: '80000000-0000-4000-8000-000000000003',
      })
      .expect(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');

    const after = await pool.query<{ orders: string; balance: number; available: string }>(`
      SELECT
        (SELECT count(*) FROM orders)::text AS orders,
        (SELECT points_balance FROM users WHERE email = 'api-test@linepool.local') AS balance,
        (SELECT count(*) FROM phone_numbers WHERE project_id = '20000000-0000-4000-8000-000000000002' AND status = 'AVAILABLE')::text AS available
    `);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('lists only the current user orders and returns owned order detail', async () => {
    const list = await agent.get('/api/orders?page=1&pageSize=20').expect(200);
    expect(list.body.pagination.totalItems).toBe(2);
    expect(list.body.data[0]).toMatchObject({
      quantity: 2,
      totalPoints: 2400,
      status: 'COMPLETED',
    });

    const detail = await agent
      .get(`/api/orders/${list.body.data[0].id}`)
      .expect(200);
    expect(detail.body.data.numbers).toHaveLength(2);

    await agent
      .get('/api/orders/99999999-9999-4999-8999-999999999999')
      .expect(404);
  });

  it('shows purchased numbers and the updated point ledger', async () => {
    const numbers = await agent
      .get('/api/numbers?page=1&pageSize=20&status=ACTIVE')
      .expect(200);
    expect(numbers.body.pagination.totalItems).toBe(3);
    expect(numbers.body.data).toHaveLength(3);
    expect(numbers.body.data.every((number: { status: string }) => number.status === 'ACTIVE')).toBe(true);

    const points = await agent
      .get('/api/points?page=1&pageSize=20')
      .expect(200);
    expect(points.body.data.balance).toBe(16400);
    expect(points.body.data.entries).toHaveLength(3);
    expect(points.body.data.entries[0]).toMatchObject({
      type: 'ORDER_DEBIT',
      delta: -2400,
      balanceAfter: 16400,
    });
  });

  it('lists inbox messages and marks only an owned message as read', async () => {
    const list = await agent.get('/api/inbox?page=1&pageSize=20').expect(200);
    expect(list.body.data).toHaveLength(2);
    const unread = list.body.data.find((message: { isRead: boolean }) => !message.isRead);
    expect(unread).toBeDefined();

    const updated = await agent
      .post(`/api/inbox/${unread.id}/read`)
      .expect(200);
    expect(updated.body.data).toMatchObject({ id: unread.id, isRead: true });

    await agent
      .post('/api/inbox/99999999-9999-4999-8999-999999999999/read')
      .expect(404);
  });

  it('returns public account fields without credential material', async () => {
    const response = await agent.get('/api/account').expect(200);
    expect(response.body.data).toMatchObject({
      email: testAccount.email,
      displayName: testAccount.displayName,
      isDemo: true,
    });
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.body.data).not.toHaveProperty('pointsBalance');
  });

  it('revokes the session on logout', async () => {
    await agent.post('/api/auth/logout').expect(200, { data: null });
    await agent.get('/api/auth/me').expect(401);
  });
});
