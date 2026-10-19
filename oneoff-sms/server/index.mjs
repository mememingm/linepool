import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.mjs';
import { createService } from './service.mjs';
import { createHttpServer } from './http.mjs';
import { loadLocalSecrets } from './secrets.mjs';

const secrets = loadLocalSecrets();
if (process.env.ONCE_PROVIDER && process.env.ONCE_PROVIDER !== 'mock') throw new Error('Only the isolated mock provider is enabled. PingCode is not configured.');
const db = openDatabase(process.env.ONCE_DB_PATH || fileURLToPath(new URL('../data/once.sqlite', import.meta.url)));
const service = createService(db, { adminToken: secrets.adminToken });
service.expire();
const server = createHttpServer(service, { distPath: fileURLToPath(new URL('../dist/', import.meta.url)), webhookSecret: secrets.webhookSecret });
const timer = setInterval(() => service.expire(), 1000);
server.listen(3028, '127.0.0.1', () => console.log('Local demo API: http://127.0.0.1:3028 (SQLite, no real transactions)'));
server.on('error', (error) => {
  console.error(error.message);
  clearInterval(timer);
  db.close();
  process.exitCode = 1;
});
function shutdown() {
  clearInterval(timer);
  server.close(() => { db.close(); });
  server.closeIdleConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
