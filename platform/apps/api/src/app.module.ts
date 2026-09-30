import { Module } from '@nestjs/common';

import { EnvironmentService } from './config/environment.service.js';
import { DatabaseService } from './database/database.service.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [EnvironmentService, DatabaseService],
  exports: [EnvironmentService, DatabaseService],
})
export class AppModule {}
