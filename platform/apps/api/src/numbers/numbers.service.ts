import type {
  AssignedNumber,
  PaginatedResponse,
  PaginationQuery,
} from '@linepool/contracts';
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';

interface NumberRow {
  id: string;
  phone_number: string;
  project_id: string;
  project_name: string;
  assigned_order_id: string;
  assigned_at: Date;
  expires_at: Date;
}

type NumberStatus = 'ACTIVE' | 'EXPIRED';

@Injectable()
export class NumbersService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    userId: string,
    query: PaginationQuery & { status?: NumberStatus | undefined },
  ): Promise<PaginatedResponse<AssignedNumber>> {
    const offset = (query.page - 1) * query.pageSize;
    const statusSql =
      query.status === 'ACTIVE'
        ? 'AND n.expires_at > now()'
        : query.status === 'EXPIRED'
          ? 'AND n.expires_at <= now()'
          : '';
    const values = [userId, query.pageSize, offset];
    const [numbers, count] = await Promise.all([
      this.database.query<NumberRow>(
        `
          SELECT n.id, n.phone_number, n.project_id, p.name AS project_name,
                 n.assigned_order_id, n.assigned_at, n.expires_at
          FROM phone_numbers n
          JOIN projects p ON p.id = n.project_id
          WHERE n.assigned_user_id = $1 AND n.status <> 'AVAILABLE' ${statusSql}
          ORDER BY n.assigned_at DESC
          LIMIT $2 OFFSET $3
        `,
        values,
      ),
      this.database.query<{ count: string }>(
        `
          SELECT count(*)
          FROM phone_numbers n
          WHERE n.assigned_user_id = $1 AND n.status <> 'AVAILABLE' ${statusSql}
        `,
        [userId],
      ),
    ]);
    const totalItems = Number(count.rows[0]?.count ?? 0);
    return {
      data: numbers.rows.map((number) => ({
        id: number.id,
        phoneNumber: number.phone_number,
        project: { id: number.project_id, name: number.project_name },
        orderId: number.assigned_order_id,
        status: number.expires_at > new Date() ? 'ACTIVE' : 'EXPIRED',
        assignedAt: number.assigned_at.toISOString(),
        expiresAt: number.expires_at.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }
}
