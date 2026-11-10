import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { isStorefrontRegion, numberUsageSchema, renewalRecordSchema,
  type CreateRenewalInput, type PaginationQuery, type RenewalRecord, type UsageQuery } from '@linepool/contracts';
import { Database } from './database.js';
import { ApiFailure } from './http.js';
import { NumberServiceProvider, type NumberResource } from './number-service-provider.js';
import { linePoolAllocationScope } from './platform-inventory.js';

type RenewalRow = {
  id: string; renewal_number: string; number_id: string; phone_number: string;
  original_expires_at: Date; duration_days: number; estimated_expires_at: Date | null;
  confirmed_expires_at: Date | null; total_points: number | null; execution_status: string;
  data_source: 'mock' | 'live'; failure_reason: string | null; created_at: Date;
};
const renewalFrom = 'FROM renewals x JOIN number_allocations a ON a.id=x.allocation_id JOIN phone_numbers n ON n.id=a.number_id';
const renewalFields = 'x.*,a.number_id,n.phone_number';
function toRenewal(row: RenewalRow): RenewalRecord {
  return renewalRecordSchema.parse({
    id: row.id, renewalNumber: row.renewal_number, numberId: row.number_id, phoneNumber: row.phone_number,
    originalExpiresAt: row.original_expires_at.toISOString(), durationDays: row.duration_days,
    estimatedExpiresAt: row.estimated_expires_at?.toISOString() ?? null,
    confirmedExpiresAt: row.confirmed_expires_at?.toISOString() ?? null,
    totalPoints: row.total_points, source: row.data_source,
    status: row.execution_status === 'COMPLETED' && row.data_source === 'live' ? 'SUCCESS' : row.execution_status === 'FAILED' ? 'FAILED' : 'PENDING',
    failureReason: row.failure_reason, createdAt: row.created_at.toISOString(),
  });
}
@Injectable()
export class NumberServices {
  constructor(private readonly db: Database, private readonly provider: NumberServiceProvider) {}
  private async ownedNumber(userId: string, id: string, client?: PoolClient): Promise<NumberResource & { region: string }> {
    const query = `SELECT n.id,n.phone_number,n.region_id,a.expires_at,a.id AS allocation_id
      FROM phone_numbers n JOIN number_allocations a ON a.number_id=n.id
      WHERE (n.id=$1 OR a.id=$1) AND a.user_id=$2 AND ${linePoolAllocationScope()} AND a.released_at IS NULL
      AND (a.receiving_status='WAITING' OR (a.receiving_mode='HOSTED' AND a.expires_at>now()))
      AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))${client ? ' FOR UPDATE OF a' : ''}`;
    type OwnedNumberRow = { id: string; phone_number: string; region_id: string; expires_at: Date; allocation_id: string };
    const { rows } = client
      ? await client.query<OwnedNumberRow>(query, [id, userId])
      : await this.db.query<OwnedNumberRow>(query, [id, userId]);
    if (rows.length > 1) throw new ApiFailure(409, 'PLATFORM_REQUIRED', 'Use the platform service allocation ID');
    const row = rows[0];
    if (!row) throw new ApiFailure(404, 'NUMBER_NOT_FOUND', 'Number is unavailable or no longer assigned to this account');
    return { id: row.id, region: row.region_id, phoneNumber: row.phone_number, expiresAt: row.expires_at.toISOString(), allocationId: row.allocation_id };
  }
  async options(userId: string, numberId: string) {
    const number = await this.ownedNumber(userId, numberId);
    if (!isStorefrontRegion(number.region)) throw new ApiFailure(409, 'REGION_NOT_AVAILABLE', 'This region is not open for storefront renewal');
    throw new ApiFailure(403, 'RENEWAL_DISABLED', 'Short-term SMS receiving services do not support renewal');
  }
  async usage(userId: string, numberId: string, query: UsageQuery) {
    return numberUsageSchema.parse(await this.provider.usage(await this.ownedNumber(userId, numberId), query.scenario));
  }
  async list(userId: string, numberId: string, input: PaginationQuery) {
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total ${renewalFrom} WHERE a.user_id=$1 AND ${linePoolAllocationScope()} AND (a.number_id=$2 OR a.id=$2)`, [userId, numberId]);
      const { rows } = await client.query<RenewalRow>(`SELECT ${renewalFields} ${renewalFrom}
        WHERE a.user_id=$1 AND ${linePoolAllocationScope()} AND (a.number_id=$2 OR a.id=$2) ORDER BY x.created_at DESC,x.id DESC LIMIT $3 OFFSET $4`,
      [userId, numberId, input.pageSize, (input.page - 1) * input.pageSize]);
      return { data: rows.map(toRenewal), pagination: { ...input, totalItems: count!.total, totalPages: Math.ceil(count!.total / input.pageSize) } };
    });
  }
  async create(userId: string, numberId: string, _input: CreateRenewalInput) {
    const number = await this.ownedNumber(userId, numberId);
    if (!isStorefrontRegion(number.region)) throw new ApiFailure(409, 'REGION_NOT_AVAILABLE', 'This region is not open for storefront renewal');
    throw new ApiFailure(403, 'RENEWAL_DISABLED', 'Short-term SMS receiving services do not support renewal');
  }
}
