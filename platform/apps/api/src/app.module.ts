import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AccountController } from './account/account.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { EnvironmentService } from './config/environment.service.js';
import { DatabaseService } from './database/database.service.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { DashboardService } from './dashboard/dashboard.service.js';
import { HealthController } from './health.controller.js';
import { InboxController } from './inbox/inbox.controller.js';
import { InboxService } from './inbox/inbox.service.js';
import { NumbersController } from './numbers/numbers.controller.js';
import { NumbersService } from './numbers/numbers.service.js';
import { OrdersController } from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { PointsController } from './points/points.controller.js';
import { PointsService } from './points/points.service.js';
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
    AccountController,
    AuthController,
    DashboardController,
    HealthController,
    InboxController,
    NumbersController,
    OrdersController,
    PointsController,
    ProjectsController,
  ],
  providers: [
    EnvironmentService,
    DatabaseService,
    AuthService,
    AuthGuard,
    DashboardService,
    InboxService,
    NumbersService,
    OrdersService,
    PointsService,
    ProjectsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [EnvironmentService, DatabaseService],
})
export class AppModule {}
