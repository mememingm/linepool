import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from 'pg';

import { EnvironmentService } from '../config/environment.service.js';
import { createDatabasePool } from './pool.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool;

  constructor(environment: EnvironmentService) {
    this.pool = createDatabasePool(environment.databaseUrl);
  }

  query<Row extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(text, [...values]);
  }

  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
