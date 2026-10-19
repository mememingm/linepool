import pg from 'pg';
import { Environment } from '../src/environment.js';

const environment = new Environment();
const email = process.argv.find(arg => arg.startsWith('--email='))?.slice(8).trim().toLowerCase();
if (!email || !email.includes('@')) throw new Error('Usage: npm run admin:grant -- --email=existing-account@example.com');
const client = new pg.Client({ connectionString: environment.values.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(734102611)');
  const { rows: [user] } = await client.query<{ id: string; role: string; account_status: string }>('SELECT id,role,account_status FROM users WHERE email=$1 FOR UPDATE', [email]);
  if (!user || user.account_status !== 'ACTIVE') throw new Error('An existing active account is required');
  if (user.role === 'ADMIN') console.log('Account already has platform administrator access');
  else {
    const { rowCount } = await client.query("SELECT id FROM users WHERE role='ADMIN'");
    if (rowCount) throw new Error('An administrator already exists; this bootstrap command cannot grant additional administrators');
    await client.query("UPDATE users SET role='ADMIN' WHERE id=$1", [user.id]);
    await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
      VALUES($1,'ADMIN_BOOTSTRAP',$2,'Explicit local operator bootstrap',$3,$4)`, [user.id, user.id, JSON.stringify({ role: 'USER' }), JSON.stringify({ role: 'ADMIN' })]);
    console.log('Platform administrator granted; sign in again with the existing account password');
  }
  await client.query('COMMIT');
} catch (failure) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(failure instanceof Error ? failure.message : 'Administrator bootstrap failed');
  process.exitCode = 1;
} finally { await client.end(); }
