import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// Local-only deployment safeguard. Never print a connection string or password.
const database = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) || process.env.NODE_ENV === 'production') {
  throw new Error('This safeguard is restricted to the local development database');
}
const directory = resolve(import.meta.dirname, '../.local/backups');
mkdirSync(directory, { recursive: true });
const output = resolve(directory, `before-short-term-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
const result = spawnSync(process.env.PG_DUMP_PATH ?? 'D:/postgresql/bin/pg_dump.exe', ['--format=custom', '--file', output], {
  env: { ...process.env, PGHOST: database.hostname, PGPORT: database.port || '5432', PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
    PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password), PGCONNECT_TIMEOUT: '5' },
  encoding: 'utf8',
});
if (result.error || result.status !== 0) throw new Error(`Database backup failed: ${result.error?.message ?? result.stderr}`);
console.log(JSON.stringify({ host: database.hostname, port: database.port || '5432', database: database.pathname.slice(1), backup: output, bytes: statSync(output).size }));
