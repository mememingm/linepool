import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { seedDemo } from '../db/demo-seed.js';
import { migrateDatabase } from '../db/migrate.js';
import { Authentication } from '../src/authentication.js';
import { Database } from '../src/database.js';
import { Environment } from '../src/environment.js';
import { Ordering } from '../src/ordering.js';
import { assertTestConnection, validateTestDatabase } from '../src/test-database.js';
import { Workspace } from '../src/workspace.js';

export const demoInput = { email: 'regression-demo@example.invalid', password: 'isolated-demo-fixture', displayName: 'Test demo' };
export const migrationDirectory = new URL('../../../db/migrations/', import.meta.url);

export async function isolatedDatabase() {
  const target = validateTestDatabase(process.env);
  const schema = `lp_test_${randomUUID().replaceAll('-', '')}`;
  const client = new pg.Client({ connectionString: target.connectionString, connectionTimeoutMillis: 5000 });
  let db: Database | undefined;
  let schemaCreated = false;
  async function close() {
    try {
      await db?.onModuleDestroy();
      if (schemaCreated) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  }
  try {
    await client.connect();
    await assertTestConnection(sql => client.query(sql), target);
    await client.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await client.query(`SET search_path TO "${schema}"`);
    await migrateDatabase(client, migrationDirectory);
    await seedDemo(client, demoInput);
    const saved = { NODE_ENV: process.env.NODE_ENV, TEST_DATABASE_SCHEMA: process.env.TEST_DATABASE_SCHEMA };
    let environment: Environment;
    try {
      process.env.NODE_ENV = 'test';
      process.env.TEST_DATABASE_SCHEMA = schema;
      environment = new Environment();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    db = new Database(environment);
    const workspace = new Workspace(db);
    return { client, db, environment, workspace, ordering: new Ordering(db, workspace), auth: new Authentication(db, environment), close };
  } catch (error) {
    await close();
    throw error;
  }
}
