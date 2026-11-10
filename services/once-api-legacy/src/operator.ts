import './config';
import { readFile } from 'node:fs/promises';
import { DbService } from './db.service';
import { PingcodeClient, PcError } from './pingcode.client';
import { OperatorService } from './operator.service';

async function grantAdmin(db: DbService, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) throw new Error('Usage: npm run pc:operator -- grant-admin --email=existing-account@example.com');
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(734102611)`;
    const user = await tx.user.findUnique({ where: { email: normalized } });
    if (!user || user.status !== 'ACTIVE') throw new Error('An existing active account is required');
    if (user.role === 'ADMIN') { console.log('Account already has administrator access'); return; }
    await tx.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.auditLog.create({ data: { userId: user.id, action: 'ADMIN_BOOTSTRAP', resourceId: user.id, targetType: 'user', reason: 'Explicit local operator bootstrap', details: { beforeRole: 'USER', afterRole: 'ADMIN' } } });
  });
  console.log('Platform administrator granted; sign in again with the existing account password');
}

async function main() {
  const [command, file, ...extra] = process.argv.slice(2);
  if (command === 'grant-admin') {
    const email = extra.find(arg => arg.startsWith('--email='))?.slice(8) || file?.replace(/^--email=/, '');
    if (!email || extra.some(arg => !arg.startsWith('--email=')) || (file && file.startsWith('--email=') === false)) throw new Error('Usage: npm run pc:operator -- grant-admin --email=existing-account@example.com');
    const db = new DbService();
    try { await grantAdmin(db, email); } finally { await db.$disconnect(); }
    return;
  }
  if (!['check', 'sync', 'assign'].includes(command) || extra.length || (command === 'check' && file) || (command === 'assign' && !file)) {
    throw new Error('Usage: npm run pc:operator -- check | sync [number-metadata.json] | assign assignment.json | grant-admin --email=existing-account@example.com');
  }
  const input: unknown = file ? JSON.parse(await readFile(file, 'utf8')) : undefined;
  const db = new DbService();
  try {
    const operator = new OperatorService(db, new PingcodeClient());
    const result = command === 'check' ? await operator.check() : command === 'sync' ? await operator.sync(input) : await operator.assign(input);
    console.log(JSON.stringify(result, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(error => {
  // Never print HTTP headers, raw upstream payloads, or configuration secrets.
  console.error(error instanceof PcError ? error.code : error instanceof Error && !('code' in error) ? error.message : 'Operator command failed; database changes were rolled back');
  process.exitCode = 1;
});
