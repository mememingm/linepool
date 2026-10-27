import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type pg from 'pg';

export async function migrateDatabase(client: pg.Client, directory: URL) {
  const appliedVersions: string[] = [];
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(734102610)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(directory)).filter(file => /^\d+_[a-z0-9_]+\.sql$/.test(file)).sort();
    for (const file of files) {
      const sql = await readFile(new URL(file, directory), 'utf8');
      // Git may check SQL out with CRLF on Windows; preserve content checks across either line ending.
      const normalizedSql = sql.replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(normalizedSql).digest('hex');
      const legacyCrlfChecksum = createHash('sha256').update(normalizedSql.replace(/\n/g, '\r\n')).digest('hex');
      const { rows: [applied] } = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE version=$1', [file],
      );
      if (applied) {
        if (applied.checksum !== checksum && applied.checksum !== legacyCrlfChecksum) throw new Error(`Applied migration changed: ${file}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [file, checksum]);
      appliedVersions.push(file);
    }
    await client.query('COMMIT');
    return appliedVersions;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
