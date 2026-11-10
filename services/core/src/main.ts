import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { RuntimeModule } from './application.js';
import { Environment } from './environment.js';
import { ApiErrorFilter } from './http.js';
import { type RawWebhookRequest } from './providers/pingcode-webhook.js';
import { prepareRuntimeDatabase } from './runtime-database.js';

async function main() {
  const environment = new Environment();
  if (!environment.isApi) throw new Error('API entrypoint requires PROCESS_ROLE=api; use the API runtime script');
  const database = await prepareRuntimeDatabase(environment);
  const app = await NestFactory.create<NestExpressApplication>(RuntimeModule.forRoot(environment, database), { bodyParser: false });
  if (environment.values.TRUSTED_PROXY_IPS.length) app.set('trust proxy', environment.values.TRUSTED_PROXY_IPS);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use('/api/once', json({ limit: '32kb', verify: (request, _response, body) => {
    const path = (request as RawWebhookRequest).originalUrl?.split('?')[0]?.replace(/\/+$/, '');
    if (path === '/api/once/webhooks/pingcode/receive' || path === '/api/once/webhooks/pingcode/send') {
      (request as RawWebhookRequest).rawBody = body;
    }
  } }));
  app.use('/api/pc/mock/authorize', urlencoded({ extended: false, limit: '16kb' }));
  app.use(json({ limit: '16kb', verify: (request, _response, body) => {
    if (request.url?.split('?')[0]?.replace(/\/+$/, '') === '/api/webhooks/pingcode') {
      (request as RawWebhookRequest).rawBody = Buffer.from(body);
    }
  } }));
  app.use(cookieParser());
  app.use((_request: unknown, response: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({
    origin: environment.allowedOrigins, credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Idempotency-Key'],
  });
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();
  await app.listen(environment.values.API_PORT, environment.values.API_HOST);
  console.log(`${environment.siteName} API: http://${environment.values.API_HOST}:${environment.values.API_PORT}/api`);
}

main().catch(error => {
  console.error('API startup failed', error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});
