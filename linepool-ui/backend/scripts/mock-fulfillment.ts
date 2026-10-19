import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { createOrderInputSchema, uuidSchema } from '@linepool/contracts';
import { Environment } from '../src/environment.js';
import { Database } from '../src/database.js';
import { Ordering } from '../src/ordering.js';
import { Workspace } from '../src/workspace.js';
import { MockFulfillment } from '../src/mock-fulfillment.js';

const environment = new Environment();
const host = new URL(environment.values.DATABASE_URL).hostname;
if (environment.values.NODE_ENV !== 'development' || !['localhost','127.0.0.1','[::1]'].includes(host)) {
  throw new Error('Deferred Mock simulator requires a local development database');
}
const [command, id, value, evidence, token] = process.argv.slice(2);
const db = new Database(environment);
try {
  const mock = new MockFulfillment(db);
  let result: unknown;
  if (command === 'create') {
    const input = createOrderInputSchema.parse(JSON.parse(await readFile(value, 'utf8')));
    result = await new Ordering(db, new Workspace(db)).create(uuidSchema.parse(id), input, 'deferred-mock');
  } else if (command === 'claim') result = await mock.claim(uuidSchema.parse(id));
  else if (command === 'resolve' && ['SUCCEEDED','FAILED','UNCERTAIN'].includes(value)) {
    result = await mock.resolve(uuidSchema.parse(id), value as 'SUCCEEDED' | 'FAILED' | 'UNCERTAIN', evidence ?? '', token);
  } else if (command === 'list') {
    result = (await db.query(`SELECT order_id,status,request_id,attempts,claim_until,evidence,updated_at
      FROM mock_fulfillment_operations WHERE status NOT IN ('SUCCEEDED','FAILED') ORDER BY updated_at,order_id LIMIT 100`)).rows;
  } else throw new Error('Usage: mock-fulfillment create USER_ID input.json | claim ORDER_ID | resolve ORDER_ID SUCCEEDED|FAILED|UNCERTAIN "local evidence" [TOKEN] | list');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Mock simulation failed');
  process.exitCode = 1;
} finally { await db.onModuleDestroy(); }
