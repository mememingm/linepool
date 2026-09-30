import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

describe('API shell', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
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
});
