import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { z } from 'zod';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const local = resolve(root, '.local');
const data = resolve(local, 'postgres');
const credentialsPath = resolve(local, 'pg-credentials.json');
const passwordPath = resolve(local, 'initdb-password');
const envPath = resolve(root, '.env');
const binaries = process.env.POSTGRES_BIN ?? 'D:/postgresql/bin';
const port = 5433;
const host = '127.0.0.1';
const database = 'linepool_react';
const credentialsSchema = z.object({
  adminUser: z.literal('linepool_react_admin'),
  adminPassword: z.string().min(32),
  appUser: z.literal('linepool_react'),
  appPassword: z.string().min(32),
});
type Credentials = z.infer<typeof credentialsSchema>;
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
function binary(name: string) { return resolve(binaries, `${name}${process.platform === 'win32' ? '.exe' : ''}`); }
function command(name: string, args: string[], allowStopped = false) {
  // Windows daemon processes can keep captured pipes open after pg_ctl exits.
  const outputPath = resolve(local, 'postgres-bootstrap.log');
  const output = openSync(outputPath, 'a', 0o600);
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(binary(name), args, { stdio: ['ignore', output, output], timeout: 90000, windowsHide: true });
  } finally { closeSync(output); }
  if (result.error) throw new Error(`${name}: ${result.error.message}`);
  if (result.status !== 0 && !(allowStopped && result.status === 3)) {
    const decoder = new TextDecoder(process.platform === 'win32' ? 'gb18030' : 'utf-8');
    console.error(decoder.decode(readFileSync(outputPath).subarray(-6000)));
    throw new Error(`${name} exited with status ${result.status}`);
  }
  return result.status;
}
function connection(user: string, password: string, name: string) {
  const url = new URL(`postgresql://${host}:${port}/${name}`);
  url.username = user;
  url.password = password;
  return url.toString();
}
async function credentials(): Promise<Credentials> {
  return credentialsSchema.parse(JSON.parse(await readFile(credentialsPath, 'utf8')));
}
async function start() {
  if (!(await exists(resolve(data, 'PG_VERSION')))) throw new Error('Private cluster is not initialized; run db:local:setup first');
  if (command('pg_ctl', ['-D', data, 'status'], true) === 0) {
    console.log('Private PostgreSQL is already running');
    return;
  }
  command('pg_ctl', ['-D', data, '-l', resolve(local, 'postgres.log'), '-o', `-h ${host} -p ${port}`, '-w', '-t', '45', 'start']);
  console.log(`Private PostgreSQL started on ${host}:${port}`);
}
async function setup() {
  if (process.env.NODE_ENV === 'production') throw new Error('Private local setup is disabled in production');
  await access(binary('initdb'));
  await access(binary('pg_ctl'));
  await mkdir(local, { recursive: true });
  if (!(await exists(credentialsPath))) {
    if (await exists(resolve(data, 'PG_VERSION'))) throw new Error('Existing private cluster has no credentials file; refusing to reset it');
    const value: Credentials = { adminUser: 'linepool_react_admin', adminPassword: randomBytes(32).toString('base64url'), appUser: 'linepool_react', appPassword: randomBytes(32).toString('base64url') };
    await writeFile(credentialsPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  const secret = await credentials();
  if (!(await exists(resolve(data, 'PG_VERSION')))) {
    await writeFile(passwordPath, `${secret.adminPassword}\n`, { mode: 0o600 });
    try {
      command('initdb', ['-D', data, '-U', secret.adminUser, '--pwfile', passwordPath,
        '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale-provider=builtin', '--builtin-locale=C.UTF-8']);
    } finally { await rm(passwordPath, { force: true }); }
    await writeFile(resolve(data, 'postgresql.auto.conf'), `listen_addresses = '${host}'\nport = ${port}\npassword_encryption = 'scram-sha-256'\n`);
  }
  await start();
  const client = new pg.Client({ connectionString: connection(secret.adminUser, secret.adminPassword, 'postgres'), connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('SELECT pg_advisory_lock(734102610)');
    const { rows: [role] } = await client.query<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean }>(
      'SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=$1', [secret.appUser],
    );
    if (!role) {
      await client.query(`CREATE ROLE linepool_react LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${pg.escapeLiteral(secret.appPassword)}`);
    } else if (role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication) {
      throw new Error('Private app role has unexpected elevated privileges');
    }
    const { rows: [existing] } = await client.query<{ owner: string }>('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1', [database]);
    if (!existing) await client.query('CREATE DATABASE linepool_react OWNER linepool_react');
    else if (existing.owner !== secret.appUser) throw new Error('Private database has an unexpected owner; refusing to change it');
  } finally { await client.end(); }
  const current = await readFile(envPath, 'utf8');
  if (!(await exists(resolve(local, 'backend-env.before-local-postgres')))) {
    await writeFile(resolve(local, 'backend-env.before-local-postgres'), current, { flag: 'wx', mode: 0o600 });
  }
  const values = parseEnv(current);
  values.DATABASE_URL = connection(secret.appUser, secret.appPassword, database);
  const content = Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n');
  await writeFile(envPath, `${content}\n`, { mode: 0o600 });
  const app = new pg.Client({ connectionString: values.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await app.connect();
    await app.query('SELECT current_database(), current_user');
  } finally { await app.end(); }
  console.log(`Private PostgreSQL ready: ${host}:${port}/${database}; app role is not a superuser`);
  console.log('Generated credentials are ignored locally; existing 5432 service and databases were not changed');
}
try {
  const action = process.argv[2];
  if (action === 'setup') await setup();
  else if (action === 'start') await start();
  else if (action === 'stop') {
    if (!(await exists(resolve(data, 'PG_VERSION')))) console.log('Private PostgreSQL is not initialized');
    else if (command('pg_ctl', ['-D', data, 'status'], true) === 0) {
      command('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '45', 'stop']);
      console.log('Private PostgreSQL stopped; data was preserved');
    } else console.log('Private PostgreSQL is already stopped');
  } else if (action === 'status') {
    if (!(await exists(resolve(data, 'PG_VERSION')))) console.log('Private PostgreSQL is not initialized');
    else console.log(command('pg_ctl', ['-D', data, 'status'], true) === 0 ? 'Private PostgreSQL is running' : 'Private PostgreSQL is stopped');
  } else throw new Error('Expected setup, start, stop or status');
} catch (error) {
  console.error('Local PostgreSQL operation failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
}
