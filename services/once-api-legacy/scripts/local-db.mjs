import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const home = join(homedir(), '.once', 'postgres-dev');
const data = join(home, 'data');
const stateFile = join(home, 'credentials.json');
const windows = process.platform === 'win32';
const candidates = [process.env.PG_BIN, ...(windows ? ['D:/postgresql/bin', 'C:/Program Files/PostgreSQL/18/bin'] : ['/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/17/bin'])].filter(Boolean);
const bin = candidates.find(path => existsSync(join(path, windows ? 'pg_ctl.exe' : 'pg_ctl')));
const executable = name => bin ? join(bin, windows ? name + '.exe' : name) : name;
function run(name, args, env = {}) {
  const result = spawnSync(executable(name), args, { stdio: 'inherit', windowsHide: true, env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(name + ' failed (' + result.status + ')');
}
if (process.argv[2] === 'stop') {
  if (existsSync(join(data, 'postmaster.pid'))) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  process.exit(0);
}
mkdirSync(home, { recursive: true });
let credentials;
if (existsSync(stateFile)) credentials = JSON.parse(readFileSync(stateFile, 'utf8'));
else {
  credentials = { admin: randomBytes(32).toString('hex'), app: randomBytes(32).toString('hex') };
  writeFileSync(stateFile, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
}
if (!existsSync(join(data, 'PG_VERSION'))) {
  const pwfile = join(home, 'init-password');
  writeFileSync(pwfile, credentials.admin, { mode: 0o600 });
  try { run('initdb', ['-D', data, '-U', 'once_admin', '--pwfile', pwfile, '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '-E', 'UTF8', '--locale=C']); }
  finally { unlinkSync(pwfile); }
}
if (!existsSync(join(data, 'postmaster.pid'))) {
  run('pg_ctl', ['-D', data, '-l', join(home, 'server.log'), '-o', '-p 55432 -h 127.0.0.1', '-w', 'start']);
}
const admin = { PGPASSWORD: credentials.admin };
const common = ['-h', '127.0.0.1', '-p', '55432', '-U', 'once_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
const role = spawnSync(executable('psql'), [...common, '-tAc', "SELECT 1 FROM pg_roles WHERE rolname = 'once'"], { encoding:'utf8', windowsHide:true, env:{...process.env,...admin} });
if (role.status !== 0) throw new Error('Cannot inspect isolated development cluster: ' + role.stderr);
if (role.stdout.trim() !== '1') run('psql', [...common, '-c', "CREATE ROLE once LOGIN PASSWORD '" + credentials.app + "' NOSUPERUSER NOCREATEDB NOCREATEROLE"], admin);
const db = spawnSync(executable('psql'), [...common, '-tAc', "SELECT 1 FROM pg_database WHERE datname = 'once'"], { encoding:'utf8', windowsHide:true, env:{...process.env,...admin} });
if (db.status !== 0) throw new Error('Cannot inspect development database: ' + db.stderr);
if (db.stdout.trim() !== '1') run('createdb', ['-h','127.0.0.1','-p','55432','-U','once_admin','-O','once','once'], admin);
const envPath = join(root, '.env');
if (!existsSync(envPath)) writeFileSync(envPath, 'DATABASE_URL=postgresql://once:' + credentials.app + '@127.0.0.1:55432/once?schema=public\nHOST=127.0.0.1\nPORT=3000\nAPP_ORIGIN=http://127.0.0.1:3000\nNODE_ENV=development\nDEMO_MODE=true\n', {mode:0o600, flag:'wx'});
console.log('Isolated PostgreSQL is ready at 127.0.0.1:55432. Existing services were not changed.');
