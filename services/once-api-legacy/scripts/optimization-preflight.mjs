import 'dotenv/config';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; this command never provisions a database.');
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout='30s'");
  const result=await client.query(await readFile(new URL('./optimization-preflight.sql',import.meta.url),'utf8'));
  console.log(JSON.stringify(result.rows[0].report,null,2));
  await client.query('ROLLBACK');
} catch(error) {
  // Do not print URLs, credentials or driver connection parameters.
  console.error('Read-only preflight failed: '+(error.code ?? error.name));
  process.exitCode=1;
} finally { await client.end().catch(()=>{}); }
