import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

const migrationsDirectory = fileURLToPath(
  new URL('../../../db/migrations/', import.meta.url),
);

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(
      'SELECT pg_advisory_lock(hashtext($1))',
      ['linepool_schema_migrations'],
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith('.sql'))
      .sort();

    for (const filename of filenames) {
      const existing = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [filename],
      );
      if (existing.rowCount) {
        continue;
      }

      const sql = await readFile(resolve(migrationsDirectory, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations(filename) VALUES ($1)',
          [filename],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query(
      'SELECT pg_advisory_unlock(hashtext($1))',
      ['linepool_schema_migrations'],
    );
    client.release();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await runMigrations(pool);
    console.info('Database migrations are up to date.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
