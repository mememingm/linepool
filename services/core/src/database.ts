import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { Environment } from './environment.js';

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool: pg.Pool;
  constructor(environment: Environment) {
    this.pool = new pg.Pool({
      connectionString: environment.values.DATABASE_URL, max: 10,
      options: environment.testSchema ? `-c search_path=${environment.testSchema}` : undefined,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
      statement_timeout: 10000,
    });
    this.pool.on('error', () => console.error('PostgreSQL idle connection failed'));
  }
  query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
    return this.pool.query<T>(text, values);
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async onModuleDestroy() { await this.pool.end(); }
}
