import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RuntimeModule } from './application.js';
import { Environment } from './environment.js';
import { prepareRuntimeDatabase } from './runtime-database.js';

async function main() {
  const environment = new Environment();
  if (!environment.isWorker) throw new Error('Worker entrypoint requires PROCESS_ROLE=worker; use the worker runtime script');
  const database = await prepareRuntimeDatabase(environment);
  const app = await NestFactory.createApplicationContext(RuntimeModule.forRoot(environment, database));
  app.enableShutdownHooks();
  console.log(`${environment.siteName} worker started; enabled modules: ${environment.enabledModules.join(', ') || 'none'}`);
}

main().catch(error => {
  console.error('Worker startup failed', error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});
