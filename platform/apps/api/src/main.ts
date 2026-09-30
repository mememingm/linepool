import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { EnvironmentService } from './config/environment.service.js';
import { configureApp } from './configure-app.js';

const app = await NestFactory.create(AppModule);
configureApp(app);

const environment = app.get(EnvironmentService);
await app.listen(environment.apiPort, '127.0.0.1');
