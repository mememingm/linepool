import pg from 'pg';
import { Environment } from '../src/environment.js';

const environment = new Environment();
const url = new URL(environment.values.DATABASE_URL);
const databaseName = decodeURIComponent(url.pathname.slice(1));
if (databaseName !== 'linepool_react') throw new Error('db:create only creates the isolated linepool_react database');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('db:create only connects to local PostgreSQL');
url.pathname = '/postgres';
const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  await client.query('SELECT pg_advisory_lock(734102610)');
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName]);
  if (existing.rowCount) {
    console.log('linepool_react already exists; no database changes made');
  } else {
    await client.query('CREATE DATABASE linepool_react');
    console.log('Created local linepool_react database');
  }
} catch (error) {
  console.error('Database creation failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
} finally {
  await client.end();
}
