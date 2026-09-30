import type {
  PaginationQuery,
  PointLedgerEntry,
  PointsResponse,
} from '@linepool/contracts';
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';

interface LedgerRow {
  id: string;
  type: 'SEED_CREDIT' | 'ORDER_DEBIT' | 'ADJUSTMENT';
  delta: number;
  balance_after: number;
  description: string;
  reference_id: string | null;
  created_at: Date;
}

function mapEntry(row: LedgerRow): PointLedgerEntry {
  return {
    id: row.id,
    type: row.type,
    delta: row.delta,
    balanceAfter: row.balance_after,
    description: row.description,
    referenceId: row.reference_id,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class PointsService {
  constructor(private readonly database: DatabaseService) {}

  async get(userId: string, query: PaginationQuery): Promise<PointsResponse> {
    const offset = (query.page - 1) * query.pageSize;
    const [user, entries, count] = await Promise.all([
      this.database.query<{ points_balance: number }>(
        'SELECT points_balance FROM users WHERE id = $1',
        [userId],
      ),
      this.database.query<LedgerRow>(
        `
          SELECT id, type, delta, balance_after, description, reference_id, created_at
          FROM point_ledger
          WHERE user_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2 OFFSET $3
        `,
        [userId, query.pageSize, offset],
      ),
      this.database.query<{ count: string }>(
        'SELECT count(*) FROM point_ledger WHERE user_id = $1',
        [userId],
      ),
    ]);
    const totalItems = Number(count.rows[0]?.count ?? 0);
    return {
      data: {
        balance: user.rows[0]?.points_balance ?? 0,
        entries: entries.rows.map(mapEntry),
      },
      pagination: {
        ...query,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }
}
