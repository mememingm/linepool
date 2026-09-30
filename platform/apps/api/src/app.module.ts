import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { EnvironmentService } from './config/environment.service.js';
import { DatabaseService } from './database/database.service.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { DashboardService } from './dashboard/dashboard.service.js';
import { HealthController } from './health.controller.js';
import { OrdersController } from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { ProjectsController } from './projects/projects.controller.js';
import { ProjectsService } from './projects/projects.service.js';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
      { name: 'auth', ttl: 15 * 60 * 1000, limit: 10 },
    ]),
  ],
  controllers: [
    AuthController,
    DashboardController,
    HealthController,
    OrdersController,
    ProjectsController,
  ],
  providers: [
    EnvironmentService,
    DatabaseService,
    AuthService,
    AuthGuard,
    DashboardService,
    OrdersService,
    ProjectsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [EnvironmentService, DatabaseService],
})
export class AppModule {}
