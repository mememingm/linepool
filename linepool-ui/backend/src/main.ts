import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import { Authentication, SessionGuard } from './authentication.js';
import { AuthController, HealthController, WorkspaceController, NumberServicesController } from './controllers.js';
import { Database } from './database.js';
import { Environment } from './environment.js';
import { ApiErrorFilter, OriginGuard } from './http.js';
import { Ordering } from './ordering.js';
import { Workspace } from './workspace.js';
import { AdminController } from './admin-controller.js';
import { Administration, AdminGuard } from './administration.js';
import { NumberServices } from './number-services.js';
import { NumberServiceProvider, MockNumberServiceProvider } from './number-service-provider.js';
import { ReceivingProvider } from './providers/receiving-provider.js';
import { MockReceivingProvider } from './providers/mock-receiving-provider.js';
import { ReceivingSync } from './providers/receiving-sync.js';
import { AllocationExpiry } from './allocation-expiry.js';
import { BusinessThrottlerGuard } from './business-throttler.js';
import { Sandbox, SandboxController } from './sandbox.js';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }])],
  controllers: [AuthController, WorkspaceController, HealthController, AdminController, NumberServicesController, SandboxController],
  providers: [Environment, Database, Authentication, SessionGuard, Workspace, Ordering, Administration, AdminGuard, NumberServices,
    AllocationExpiry, ReceivingSync, Sandbox, { provide: ReceivingProvider, useFactory: () => new MockReceivingProvider() },
    { provide: NumberServiceProvider, useClass: MockNumberServiceProvider },
    { provide: APP_GUARD, useClass: OriginGuard }, { provide: APP_GUARD, useClass: BusinessThrottlerGuard }],
})
class Application {}
async function main() {
  const app = await NestFactory.create<NestExpressApplication>(Application, { bodyParser: false });
  const environment = app.get(Environment);
  if (environment.values.TRUSTED_PROXY_IPS.length) app.set('trust proxy', environment.values.TRUSTED_PROXY_IPS);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(json({ limit: '16kb' }));
  app.use(cookieParser());
  app.use((_request: unknown, response: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({
    origin: environment.values.WEB_ORIGIN, credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type'],
  });
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();
  await app.get(Database).query('SELECT 1');
  await app.listen(environment.values.API_PORT, environment.values.API_HOST);
  console.log(`LINEPOOL demo API: http://${environment.values.API_HOST}:${environment.values.API_PORT}/api`);
}
main().catch(error => {
  console.error('API startup failed', error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});
