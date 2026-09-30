import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { EnvironmentService } from './config/environment.service.js';
import { ApiExceptionFilter } from './errors/api-exception.filter.js';

export function configureApp(app: INestApplication): void {
  const environment = app.get(EnvironmentService);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use(helmet());
  app.enableCors({
    origin: environment.webOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  });
  app.useGlobalFilters(new ApiExceptionFilter());
}
