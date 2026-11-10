import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const [role, site, ...extra] = process.argv.slice(2);
if (!['api', 'worker'].includes(role) || (site && !['linepool', 'once'].includes(site)) || extra.length) {
  throw new Error('Usage: node scripts/run-runtime.mjs api|worker [linepool|once]');
}
const coreDirectory = fileURLToPath(new URL('../', import.meta.url));
const envFile = resolve(coreDirectory, process.env.CORE_ENV_FILE ?? (site === 'once' ? '.env.once' : '.env'));
const entrypoint = resolve(coreDirectory, `dist/core/src/${role === 'api' ? 'main' : 'worker'}.js`);
const child = spawn(process.execPath, [`--env-file=${envFile}`, entrypoint], {
  cwd: coreDirectory,
  env: { ...process.env, PROCESS_ROLE: role, ...(site ? { SITE_ID: site } : {}) },
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => {
  console.error('Runtime could not start:', error.message);
  process.exitCode = 1;
});
child.on('exit', code => { process.exitCode = code ?? 1; });
